import { readFileSync } from "node:fs";
import { afterAll, beforeEach, expect, test } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { appendEvents } from "./ops/events.ts";
import { events, permissionRequests, questions, runs } from "./schema/index.ts";
import { createTestDb, seedExecution, seedRun, truncateAll } from "./testing/index.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const backfill = readFileSync(new URL("../drizzle/20261002113358_notify_text/migration.sql", import.meta.url), "utf8");
const texts = async (runId: string) =>
  (await db.select({ payload: events.payload }).from(events).where(and(eq(events.runId, runId), eq(events.type, "notify"))).orderBy(asc(events.seq))).map((e) => {
    const { title, body } = e.payload as { title?: string; body?: string };
    return [title, body];
  });

test("earlier notifications get the title and body the feed wrote for them when it read them", async () => {
  const { run, project } = await seedRun(db);
  await db.update(runs).set({ task: "Add a CHANGELOG.md" }).where(eq(runs.id, run.id));
  const long = `${"The repository has no license file and the README names two. ".repeat(4)}Which license?`;
  const ask = async (nodeKey: string, values: { question: string; context?: Record<string, unknown> }) => {
    const gate = await seedExecution(db, run.id, { nodeKey, nodeType: "human_gate", executorKind: "human", status: "waiting" });
    const [question] = await db.insert(questions).values({ runId: run.id, nodeExecutionId: gate.id, ...values }).returning();
    return { kind: "input", nodeKey, questionId: question!.id };
  };
  const coder = await seedExecution(db, run.id, { nodeKey: "coder", status: "running" });
  const permission = async (toolName: string, input: Record<string, unknown>) => {
    const id = crypto.randomUUID();
    await db.insert(permissionRequests).values({ id, runId: run.id, nodeExecutionId: coder.id, toolName, input });
    return { kind: "permission", nodeKey: "coder", requestId: id };
  };
  const payloads = [
    { kind: "started", nodeKey: "start" },
    { kind: "finished" },
    { kind: "failed", nodeKey: "coder", reason: "node_failed" },
    { kind: "failed", nodeKey: "tester", reason: "loop_exhausted" },
    { kind: "failed" },
    { kind: "ready", nodeKey: "merge", number: 54 },
    { kind: "merged", nodeKey: "merge", number: 54 },
    await ask("gate", { question: "Which license?" }),
    await ask("review", { question: "Review the plan from planner", context: { reason: "approval", review: { from: "planner", kind: "plan", markdown: "Plan" } } }),
    await ask("try", { question: "Try the app and check each acceptance criterion.", context: { reason: "try" } }),
    await ask("summarized", { question: long, context: { reason: "needs_input", summary: "MIT or Apache-2.0?" } }),
    await ask("long", { question: long }),
    await permission("Bash", { command: "git log --oneline -8" }),
    await permission("Edit", { file_path: "src/app.ts", old_string: "a", new_string: "b" }),
    await permission("WebFetch", { url: "https://example.com" }),
    await permission("WebSearch", { query: "spdx license list" }),
    await permission("mcp__github__create_issue", { title: "Bug" }),
    { kind: "merged", nodeKey: "merge", number: 7, title: "Kept title", body: "Kept body" },
  ];
  await db.transaction((tx) => appendEvents(tx, run.id, payloads.map((payload) => ({ type: "notify", payload }))));

  await db.execute(sql.raw(backfill));
  const name = project.name;
  const task = "Add a CHANGELOG.md";
  const after = await texts(run.id);
  expect(after.slice(0, 11)).toEqual([
    [`${name}: run started`, task],
    [`${name}: run finished`, task],
    [`${name}: run failed at coder`, task],
    [`${name}: tester ran out of rounds`, task],
    [`${name}: run failed`, task],
    [`${name}: PR #54 is ready to merge`, task],
    [`${name}: PR #54 merged`, task],
    [`${name}: gate asks a question`, "Which license?"],
    [`${name}: the plan from planner needs your review`, task],
    [`${name}: the app is ready for you to try`, task],
    [`${name}: summarized asks a question`, "MIT or Apache-2.0?"],
  ]);
  const [title, cut] = after[11]!;
  expect(title).toBe(`${name}: long asks a question`);
  expect(cut).toMatch(/^The repository has no license file and the README names two\. .*…$/);
  expect(cut!.length).toBeLessThanOrEqual(140);
  expect(after.slice(12)).toEqual([
    [`${name}: coder asks to run a command`, "git log --oneline -8"],
    [`${name}: coder asks to change a file`, "src/app.ts"],
    [`${name}: coder asks to fetch a page`, "https://example.com"],
    [`${name}: coder asks to search the web`, "spdx license list"],
    [`${name}: coder asks to use mcp__github__create_issue`, '{"title": "Bug"}'],
    ["Kept title", "Kept body"],
  ]);

  // Running it again changes nothing.
  await db.execute(sql.raw(backfill));
  expect(await texts(run.id)).toEqual(after);
});
