import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { appendEvents, eq, projects, questions, sql } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs";
import type { NotificationFilter } from "../lib/notifications";
import { listNotifications, markNotificationsRead } from "./notifications";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

async function setUp() {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const start = (task: string) => startRunFromGraph(db, { projectId: project.id, graphName: "g", task });
  const event = (runId: string, type: string, payload: Record<string, unknown> = {}) => db.transaction((tx) => appendEvents(tx, runId, [{ type, payload }]));
  // Spread the rows out in time, oldest first, so the order does not depend on one transaction's clock.
  const age = (minutes: number) => db.execute(sql`update events set created_at = now() - make_interval(mins => ${minutes}) where created_at > now() - interval '1 second'`);
  return { project, start, event, age };
}

test("the feed lists runs that started, finished or failed and questions for a person, newest first", async () => {
  const { project, start, event, age } = await setUp();
  const done = await start("Add a CHANGELOG.md");
  await event(done.id, "run.started");
  await age(50);
  await event(done.id, "run.succeeded");
  await age(40);
  const broken = await start("Add usage docs");
  await event(broken.id, "run.failed", { nodeKey: "coder", reason: "node_failed" });
  await age(30);
  const stuck = await start("Review until done");
  await event(stuck.id, "run.failed", { nodeKey: "code_review", reason: "loop_exhausted" });
  await age(20);
  const asking = await start("Build a todo app");
  const gate = await seedExecution(db, asking.id, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  const [review] = await db
    .insert(questions)
    .values({ runId: asking.id, nodeExecutionId: gate.id, question: "Review the plan from planner", context: { reason: "approval", review: { from: "planner", kind: "plan", markdown: "Plan" } } })
    .returning();
  const gate2 = await seedExecution(db, asking.id, { nodeKey: "ask", nodeType: "human_gate", executorKind: "human", status: "waiting", attempt: 2 });
  const [question] = await db.insert(questions).values({ runId: asking.id, nodeExecutionId: gate2.id, question: "Which license?" }).returning();
  // Other events are not news.
  await event(asking.id, "node.claimed");

  const { items, unread } = await listNotifications(db, { limit: 8 });
  const run = (id: string) => `/projects/${project.id}/runs/${id}`;
  expect(items.map(({ kind, title, body, href }) => ({ kind, title, body, href }))).toEqual([
    { kind: "input", title: "sandbox: ask asks a question", body: "Which license?", href: run(asking.id) },
    { kind: "input", title: "sandbox: the plan from planner needs your review", body: "Build a todo app", href: `${run(asking.id)}/review/${review!.id}` },
    { kind: "failed", title: "sandbox: code_review ran out of rounds", body: "Review until done", href: run(stuck.id) },
    { kind: "failed", title: "sandbox: run failed at coder", body: "Add usage docs", href: run(broken.id) },
    { kind: "finished", title: "sandbox: run finished", body: "Add a CHANGELOG.md", href: run(done.id) },
    { kind: "started", title: "sandbox: run started", body: "Add a CHANGELOG.md", href: run(done.id) },
  ]);
  expect(items[0]!.id).toBe(`question:${question!.id}`);
  expect(items.every((i) => i.unread)).toBe(true);
  expect(unread).toBe(6);
  expect((await listNotifications(db, { limit: 2 })).items.map((i) => i.kind)).toEqual(["input", "input"]);
});

test("opening the feed marks what it showed as read, and later items are unread again", async () => {
  const { start, event, age } = await setUp();
  const first = await start("Add a CHANGELOG.md");
  await event(first.id, "run.started");
  await age(10);
  const { items } = await listNotifications(db, { limit: 8 });
  await markNotificationsRead(db, items[0]!.createdAt);
  expect(await listNotifications(db, { limit: 8 })).toMatchObject({ unread: 0, items: [{ unread: false }] });

  await event(first.id, "run.succeeded");
  const after = await listNotifications(db, { limit: 8 });
  expect(after.unread).toBe(1);
  expect(after.items.map((i) => [i.kind, i.unread])).toEqual([
    ["finished", true],
    ["started", false],
  ]);
  // Marking read never moves the watermark back.
  await markNotificationsRead(db, after.items[0]!.createdAt);
  await markNotificationsRead(db, items[0]!.createdAt);
  expect((await listNotifications(db, { limit: 8 })).unread).toBe(0);
});

test("the demo project's runs stay out of the feed", async () => {
  const { project, start, event } = await setUp();
  const run = await start("Add a CHANGELOG.md");
  await event(run.id, "run.started");
  await db.update(projects).set({ isDemo: true }).where(eq(projects.id, project.id));
  expect(await listNotifications(db, { limit: 8 })).toEqual({ items: [], unread: 0 });
});

test("older notifications page back from a time", async () => {
  const { start, event, age } = await setUp();
  const run = await start("Add a CHANGELOG.md");
  await event(run.id, "run.started");
  await age(30);
  await event(run.id, "run.failed", { nodeKey: "coder", reason: "node_failed" });
  await age(20);
  await event(run.id, "run.succeeded");
  const [newest] = (await listNotifications(db, { limit: 1 })).items;
  const older = await listNotifications(db, { limit: 8, before: newest!.createdAt });
  expect(older.items.map((i) => i.kind)).toEqual(["failed", "started"]);
});

test("the feed narrows to unread items, or to one kind", async () => {
  const { start, event, age } = await setUp();
  const run = await start("Add a CHANGELOG.md");
  await event(run.id, "run.started");
  await age(30);
  await event(run.id, "run.failed", { nodeKey: "coder", reason: "node_failed" });
  await age(20);
  const gate = await seedExecution(db, run.id, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  await db.insert(questions).values({ runId: run.id, nodeExecutionId: gate.id, question: "Which license?" });
  await db.execute(sql`update questions set created_at = now() - interval '10 minutes'`);
  const all = await listNotifications(db, { limit: 8 });
  await markNotificationsRead(db, all.items[0]!.createdAt);
  await event(run.id, "run.succeeded");

  const kinds = async (filter?: NotificationFilter) => (await listNotifications(db, { limit: 8, ...(filter ? { filter } : {}) })).items.map((i) => i.kind);
  expect(await kinds()).toEqual(["finished", "input", "failed", "started"]);
  expect(await kinds("unread")).toEqual(["finished"]);
  expect(await kinds("input")).toEqual(["input"]);
  expect(await kinds("failed")).toEqual(["failed"]);
  expect(await kinds("finished")).toEqual(["finished"]);
  // The unread count is for the whole feed, whatever it is narrowed to.
  expect((await listNotifications(db, { limit: 8, filter: "failed" })).unread).toBe(1);
});

test("a pull request first in line and waiting for a person is a notification that needs you", async () => {
  const { project, start, event, age } = await setUp();
  const run = await start("Add a CHANGELOG.md");
  await event(run.id, "run.started");
  await age(5);
  await event(run.id, "merge.ready", { number: 54 });
  const { items } = await listNotifications(db, { limit: 8 });
  expect(items[0]).toMatchObject({ kind: "ready", title: "sandbox: PR #54 is ready to merge", body: "Add a CHANGELOG.md", href: `/projects/${project.id}/runs/${run.id}` });
  expect((await listNotifications(db, { limit: 8, filter: "input" })).items.map((i) => i.kind)).toEqual(["ready"]);
});
