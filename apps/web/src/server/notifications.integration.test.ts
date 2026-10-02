import { afterAll, beforeEach, expect, test } from "vitest";
import { createNotification, eq, projects, sql, type NewNotification } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { createProject } from "./graphs";
import type { NotificationFilter } from "../lib/notifications";
import { listNotifications, markNotificationsRead } from "./notifications";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

async function setUp() {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  const run = `/projects/${project.id}/runs/r1`;
  // A notification as a sender writes it: its own title, body and link.
  const tell = (tone: NewNotification["tone"], title: string, extra: Partial<NewNotification> = {}) => createNotification(db, { tone, title, body: `${title}, in short`, href: run, projectId: project.id, ...extra });
  // Spread the rows out in time, oldest first, so the order does not depend on one transaction's clock.
  const age = (minutes: number) => db.execute(sql`update notifications set created_at = now() - make_interval(mins => ${minutes}) where created_at > now() - interval '1 second'`);
  return { project, run, tell, age };
}

test("the feed lists notifications newest first, each with the tone, title, body and link its sender wrote", async () => {
  const { run, tell, age } = await setUp();
  await tell("neutral", "sandbox: run started");
  await age(30);
  await tell("danger", "sandbox: run failed at coder");
  await age(20);
  await tell("attention", "sandbox: gate asks a question", { body: "Which license?", href: `${run}/review/q1` });
  await age(10);
  await tell("success", "sandbox: run finished");

  const { items, unread } = await listNotifications(db, { limit: 8 });
  expect(items.map(({ tone, title, body, href }) => ({ tone, title, body, href }))).toEqual([
    { tone: "success", title: "sandbox: run finished", body: "sandbox: run finished, in short", href: run },
    { tone: "attention", title: "sandbox: gate asks a question", body: "Which license?", href: `${run}/review/q1` },
    { tone: "danger", title: "sandbox: run failed at coder", body: "sandbox: run failed at coder, in short", href: run },
    { tone: "neutral", title: "sandbox: run started", body: "sandbox: run started, in short", href: run },
  ]);
  expect(items[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(items.every((i) => i.unread)).toBe(true);
  expect(unread).toBe(4);
  expect((await listNotifications(db, { limit: 2 })).items.map((i) => i.tone)).toEqual(["success", "attention"]);
});

test("a notification without a link, a project or a run is listed as it is", async () => {
  await createNotification(db, { tone: "neutral", title: "The worker restarted", body: "" });
  expect((await listNotifications(db, { limit: 8 })).items).toMatchObject([{ tone: "neutral", title: "The worker restarted", body: "", href: null, unread: true }]);
});

test("opening the feed marks what it showed as read, and later items are unread again", async () => {
  const { tell, age } = await setUp();
  await tell("neutral", "sandbox: run started");
  await age(10);
  const { items } = await listNotifications(db, { limit: 8 });
  await markNotificationsRead(db, items[0]!.createdAt);
  expect(await listNotifications(db, { limit: 8 })).toMatchObject({ unread: 0, items: [{ unread: false }] });

  await tell("success", "sandbox: run finished");
  const after = await listNotifications(db, { limit: 8 });
  expect(after.unread).toBe(1);
  expect(after.items.map((i) => [i.tone, i.unread])).toEqual([
    ["success", true],
    ["neutral", false],
  ]);
  // Marking read never moves the watermark back.
  await markNotificationsRead(db, after.items[0]!.createdAt);
  await markNotificationsRead(db, items[0]!.createdAt);
  expect((await listNotifications(db, { limit: 8 })).unread).toBe(0);
});

test("the demo project's notifications stay out of the feed", async () => {
  const { project, tell } = await setUp();
  await tell("neutral", "sandbox: run started");
  await db.update(projects).set({ isDemo: true }).where(eq(projects.id, project.id));
  expect(await listNotifications(db, { limit: 8 })).toEqual({ items: [], unread: 0 });
});

test("older notifications page back from a time", async () => {
  const { tell, age } = await setUp();
  await tell("neutral", "sandbox: run started");
  await age(30);
  await tell("danger", "sandbox: run failed at coder");
  await age(20);
  await tell("success", "sandbox: run finished");
  const [newest] = (await listNotifications(db, { limit: 1 })).items;
  const older = await listNotifications(db, { limit: 8, before: newest!.createdAt });
  expect(older.items.map((i) => i.tone)).toEqual(["danger", "neutral"]);
});

test("the feed narrows to unread items, or to one tone", async () => {
  const { tell, age } = await setUp();
  await tell("neutral", "sandbox: run started");
  await age(30);
  await tell("danger", "sandbox: run failed at coder");
  await age(20);
  await tell("attention", "sandbox: gate asks a question");
  await age(10);
  const all = await listNotifications(db, { limit: 8 });
  await markNotificationsRead(db, all.items[0]!.createdAt);
  await tell("success", "sandbox: run finished");

  const tones = async (filter?: NotificationFilter) => (await listNotifications(db, { limit: 8, ...(filter ? { filter } : {}) })).items.map((i) => i.tone);
  expect(await tones()).toEqual(["success", "attention", "danger", "neutral"]);
  expect(await tones("unread")).toEqual(["success"]);
  expect(await tones("attention")).toEqual(["attention"]);
  expect(await tones("danger")).toEqual(["danger"]);
  expect(await tones("success")).toEqual(["success"]);
  // The unread count is for the whole feed, whatever it is narrowed to.
  expect((await listNotifications(db, { limit: 8, filter: "danger" })).unread).toBe(1);
});
