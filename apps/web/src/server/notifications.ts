import { alias, and, desc, eq, events, nodeExecutions, not, notificationReads, permissionRequests, projects, questions, runs, sql, type Db } from "@handoff/db";
import { describePermission } from "../lib/permission";
import { reviewPath, runPath, tryPath } from "../lib/paths";
import type { NotificationFilter, NotificationItem, NotificationKind } from "../lib/notifications";

/** The kinds a filter shows: "Needs you" covers questions, permission requests and pull requests ready to merge; "Finished" merges too. */
const kindsOf = (filter: NotificationKind): NotificationKind[] =>
  filter === "input" ? ["input", "permission", "ready"] : filter === "finished" ? ["finished", "merged"] : [filter];

/** What a node said in its notification: what about, which node, and the details its kind needs. */
type Payload = { kind: NotificationKind; nodeKey?: string; reason?: string; number?: number; questionId?: string; requestId?: string };

const kind = sql<string>`${events.payload}->>'kind'`;

// Postgres keeps microseconds and a JS Date milliseconds; compare at milliseconds so a time read back marks its own item.
const ms = sql`date_trunc('milliseconds', ${events.createdAt})`;

/** The step that sent the notification: for a pull request ready to merge, the merge step that waits. */
const emitter = alias(nodeExecutions, "emitter");

/**
 * Whether the person has done what a notification asked: a question is done once answered or once its
 * run ended; a permission request once answered or expired; a pull request ready to merge once its
 * merge was asked for or its merge step stopped waiting; a failed run once it was repaired. The others
 * ask nothing.
 */
const done = sql<boolean>`case ${kind}
  when 'input' then ${questions.answeredAt} is not null or ${runs.status} in ('succeeded', 'failed', 'cancelled')
  when 'permission' then ${permissionRequests.status} is distinct from 'pending'
  when 'ready' then ${runs.mergeRequestedAt} is not null or coalesce(${emitter.status} <> 'waiting', false)
  when 'failed' then ${runs.status} <> 'failed'
  else false end`;

function failedTitle(projectName: string, { nodeKey, reason }: Payload) {
  if (reason === "loop_exhausted") return `${projectName}: ${nodeKey ?? "a step"} ran out of rounds`;
  return nodeKey ? `${projectName}: run failed at ${nodeKey}` : `${projectName}: run failed`;
}

async function readUntil(db: Db) {
  const [row] = await db.select({ readUntil: notificationReads.readUntil }).from(notificationReads);
  return row?.readUntil;
}

/** The notifications nodes sent, with their run, project, question and sending step. Demo runs stay out. */
const feed = (db: Db) =>
  db
    .select({
      id: events.id,
      payload: events.payload,
      createdAt: events.createdAt,
      done,
      runId: runs.id,
      projectId: runs.projectId,
      task: runs.task,
      projectName: projects.name,
      question: questions.question,
      context: questions.context,
      toolName: permissionRequests.toolName,
      toolInput: permissionRequests.input,
    })
    .from(events)
    .innerJoin(runs, eq(runs.id, events.runId))
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .leftJoin(questions, sql`${questions.id} = (${events.payload}->>'questionId')::uuid`)
    .leftJoin(permissionRequests, sql`${permissionRequests.id} = (${events.payload}->>'requestId')::uuid`)
    .leftJoin(emitter, eq(emitter.id, events.nodeExecutionId))
    .$dynamic();

type Row = Awaited<ReturnType<ReturnType<typeof feed>["execute"]>>[number];

function toItem(row: Row, until: Date | undefined): NotificationItem {
  const payload = row.payload as Payload;
  const base = { id: `event:${row.id}`, kind: payload.kind, body: row.task, href: runPath(row.projectId, row.runId), createdAt: row.createdAt, done: row.done };
  const unread = !row.done && (!until || row.createdAt.getTime() > until.getTime());
  const name = row.projectName;
  switch (payload.kind) {
    case "failed":
      return { ...base, title: failedTitle(name, payload), unread };
    case "ready":
      return { ...base, title: `${name}: PR #${payload.number} is ready to merge`, unread };
    case "permission": {
      const { action, detail } = describePermission(row.toolName ?? "a tool", row.toolInput ?? {});
      return { ...base, title: `${name}: ${payload.nodeKey ?? "a step"} ${action}`, body: detail || row.task, unread };
    }
    case "merged":
      return { ...base, title: `${name}: PR #${payload.number} merged`, unread };
    case "input": {
      const context = row.context as { review?: { from?: string; kind?: string }; reason?: string } | null;
      const review = context?.review;
      if (context?.reason === "try" && payload.questionId) return { ...base, title: `${name}: the app is ready for you to try`, href: tryPath(row.projectId, row.runId, payload.questionId), unread };
      if (review && payload.questionId) return { ...base, title: `${name}: the ${review.kind} from ${review.from} needs your review`, href: reviewPath(row.projectId, row.runId, payload.questionId), unread };
      return { ...base, title: `${name}: ${payload.nodeKey ?? "a gate"} asks a question`, body: row.question ?? row.task, unread };
    }
    default:
      return { ...base, title: `${name}: run ${payload.kind}`, unread };
  }
}

/**
 * The notification feed, newest first: what nodes said a person should hear about. A Start node can say
 * the run started, a Finish node that it finished, any node that it failed the run, a gate that it waits
 * for a person, and a merge node that its pull request is ready or merged. Each item says whether its
 * action is done, and is unread when it came after the person last opened the feed and is not done.
 * `before` pages back from a time, and `filter` narrows to the unread items or to one kind; "Needs you"
 * leaves out what is done.
 */
export async function listNotifications(db: Db, { limit, before, filter }: { limit: number; before?: Date; filter?: NotificationFilter }) {
  const until = await readUntil(db);
  const kinds = filter && filter !== "unread" ? kindsOf(filter) : undefined;
  const rows = await feed(db)
    .where(
      and(
        eq(events.type, "notify"),
        eq(projects.isDemo, false),
        kinds ? sql`${kind} in ${kinds}` : undefined,
        before ? sql`${ms} < ${before}` : undefined,
        filter === "unread" || filter === "input" ? not(done) : undefined,
        filter === "unread" && until ? sql`${ms} > ${until}` : undefined,
      ),
    )
    .orderBy(desc(events.createdAt), desc(events.id))
    .limit(limit);
  return { items: rows.map((row) => toItem(row, until)), unread: await unreadCount(db, until) };
}

/** How many notifications not yet done came after the watermark, all of them when the feed was never opened. */
async function unreadCount(db: Db, until: Date | undefined) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .innerJoin(runs, eq(runs.id, events.runId))
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .leftJoin(questions, sql`${questions.id} = (${events.payload}->>'questionId')::uuid`)
    .leftJoin(permissionRequests, sql`${permissionRequests.id} = (${events.payload}->>'requestId')::uuid`)
    .leftJoin(emitter, eq(emitter.id, events.nodeExecutionId))
    .where(and(eq(events.type, "notify"), eq(projects.isDemo, false), not(done), until ? sql`${ms} > ${until}` : undefined));
  return row?.n ?? 0;
}

/** Marks everything up to `until` as read. The watermark only moves forward. */
export async function markNotificationsRead(db: Db, until: Date) {
  await db
    .insert(notificationReads)
    .values({ id: 1, readUntil: until })
    .onConflictDoUpdate({ target: notificationReads.id, set: { readUntil: sql`greatest(${notificationReads.readUntil}, excluded.read_until)` } });
}
