import { and, desc, eq, events, inArray, nodeExecutions, notificationReads, projects, questions, runs, sql, type Db } from "@handoff/db";
import { reviewPath, runPath } from "../lib/paths";
import type { NotificationFilter, NotificationItem, NotificationKind } from "../lib/notifications";

/** The run events that are news, and the kind each one is. */
const EVENT_KINDS: Record<string, NotificationKind> = { "run.started": "started", "run.succeeded": "finished", "run.failed": "failed" };

// Postgres keeps microseconds and a JS Date milliseconds; compare at milliseconds so a time read back marks its own item.
const ms = (column: typeof events.createdAt | typeof questions.createdAt) => sql`date_trunc('milliseconds', ${column})`;

function failedTitle(projectName: string, payload: unknown) {
  const { nodeKey, reason } = (payload ?? {}) as { nodeKey?: string; reason?: string };
  if (reason === "loop_exhausted") return `${projectName}: ${nodeKey ?? "a step"} ran out of rounds`;
  return nodeKey ? `${projectName}: run failed at ${nodeKey}` : `${projectName}: run failed`;
}

async function readUntil(db: Db) {
  const [row] = await db.select({ readUntil: notificationReads.readUntil }).from(notificationReads);
  return row?.readUntil;
}

/**
 * The notification feed, newest first: runs that started, finished or failed, and questions a gate
 * asked a person. Each item says whether it came after the person last opened the feed. Demo runs
 * stay out. `before` pages back from a time, and `filter` narrows to the unread items or to one kind.
 */
export async function listNotifications(db: Db, { limit, before, filter }: { limit: number; before?: Date; filter?: NotificationFilter }) {
  const until = await readUntil(db);
  const visible = eq(projects.isDemo, false);
  const eventTypes = Object.keys(EVENT_KINDS).filter((type) => !filter || filter === "unread" || EVENT_KINDS[type] === filter);
  const withQuestions = !filter || filter === "unread" || filter === "input";
  const unreadOnly = (column: typeof events.createdAt | typeof questions.createdAt) => (filter === "unread" && until ? sql`${ms(column)} > ${until}` : undefined);
  const eventQuery = () =>
    db
      .select({ id: events.id, type: events.type, payload: events.payload, createdAt: events.createdAt, runId: runs.id, projectId: runs.projectId, task: runs.task, projectName: projects.name })
      .from(events)
      .innerJoin(runs, eq(runs.id, events.runId))
      .innerJoin(projects, eq(projects.id, runs.projectId))
      .where(and(inArray(events.type, eventTypes), visible, before ? sql`${ms(events.createdAt)} < ${before}` : undefined, unreadOnly(events.createdAt)))
      .orderBy(desc(events.createdAt))
      .limit(limit);
  const questionQuery = () =>
    db
      .select({
        id: questions.id,
        question: questions.question,
        context: questions.context,
        createdAt: questions.createdAt,
        runId: runs.id,
        projectId: runs.projectId,
        task: runs.task,
        projectName: projects.name,
        nodeKey: nodeExecutions.nodeKey,
      })
      .from(questions)
      .innerJoin(runs, eq(runs.id, questions.runId))
      .innerJoin(projects, eq(projects.id, runs.projectId))
      .innerJoin(nodeExecutions, eq(nodeExecutions.id, questions.nodeExecutionId))
      .where(and(visible, before ? sql`${ms(questions.createdAt)} < ${before}` : undefined, unreadOnly(questions.createdAt)))
      .orderBy(desc(questions.createdAt))
      .limit(limit);
  const [eventRows, questionRows] = await Promise.all([eventTypes.length ? eventQuery() : [], withQuestions ? questionQuery() : []]);
  const isUnread = (at: Date) => !until || at.getTime() > until.getTime();
  const fromEvents = eventRows.map((e): NotificationItem => {
    const kind = EVENT_KINDS[e.type]!;
    const title = kind === "failed" ? failedTitle(e.projectName, e.payload) : `${e.projectName}: run ${kind}`;
    return { id: `event:${e.id}`, kind, title, body: e.task, href: runPath(e.projectId, e.runId), createdAt: e.createdAt, unread: isUnread(e.createdAt) };
  });
  const fromQuestions = questionRows.map((q): NotificationItem => {
    const review = (q.context as { review?: { from?: string; kind?: string } }).review;
    return {
      id: `question:${q.id}`,
      kind: "input",
      title: review ? `${q.projectName}: the ${review.kind} from ${review.from} needs your review` : `${q.projectName}: ${q.nodeKey} asks a question`,
      body: review ? q.task : q.question,
      href: review ? reviewPath(q.projectId, q.runId, q.id) : runPath(q.projectId, q.runId),
      createdAt: q.createdAt,
      unread: isUnread(q.createdAt),
    };
  });
  const items = [...fromEvents, ...fromQuestions].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
  return { items, unread: await unreadCount(db, until) };
}

/** How many notifications came after the watermark, all of them when the feed was never opened. */
async function unreadCount(db: Db, until: Date | undefined) {
  const visible = eq(projects.isDemo, false);
  const [[fromEvents], [fromQuestions]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(events)
      .innerJoin(runs, eq(runs.id, events.runId))
      .innerJoin(projects, eq(projects.id, runs.projectId))
      .where(and(inArray(events.type, Object.keys(EVENT_KINDS)), visible, until ? sql`${ms(events.createdAt)} > ${until}` : undefined)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(questions)
      .innerJoin(runs, eq(runs.id, questions.runId))
      .innerJoin(projects, eq(projects.id, runs.projectId))
      .where(and(visible, until ? sql`${ms(questions.createdAt)} > ${until}` : undefined)),
  ]);
  return (fromEvents?.n ?? 0) + (fromQuestions?.n ?? 0);
}

/** Marks everything up to `until` as read. The watermark only moves forward. */
export async function markNotificationsRead(db: Db, until: Date) {
  await db
    .insert(notificationReads)
    .values({ id: 1, readUntil: until })
    .onConflictDoUpdate({ target: notificationReads.id, set: { readUntil: sql`greatest(${notificationReads.readUntil}, excluded.read_until)` } });
}
