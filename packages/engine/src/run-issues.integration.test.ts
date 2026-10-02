import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { FakeCliExecutor } from "@handoff/cli-adapter/testing";
import { eq, runs } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { cliNodeExecutor } from "./executors/cli-node.ts";
import { createRun } from "./runs.ts";
import { drain, engineDeps, seedGraph } from "./testing/harness.ts";
import { outputs, scripted } from "./testing/scripted.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const issue = { number: 12, title: "Slugify drops digits", url: "https://github.com/octo/sample/issues/12", body: "slugify('2nd') returns 'nd'." };

test("a run linked to issues keeps them on the run and in its state", async () => {
  const { project, graphVersion } = await seedGraph(db, linear);
  const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Fix the slugify issue", issues: [issue] });
  const [row] = await db.select().from(runs).where(eq(runs.id, run.id));
  expect(row!.issues).toEqual([{ number: 12, title: "Slugify drops digits", url: issue.url }]);
  expect(row!.state.issues).toEqual([issue]);
});

test("the Planner of a run linked to issues reads them in its context", async () => {
  const { project, graphVersion } = await seedGraph(db, linear);
  await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Fix the slugify issue", issues: [issue] });
  const cli = new FakeCliExecutor([{ output: outputs.planner }]);
  await drain(engineDeps(db, { planner: cliNodeExecutor({ cli, maxTurns: 10, timeoutMs: 60_000 }), coder: scripted({ kind: "waiting", wait: { kind: "human", token: crypto.randomUUID() } }) }));
  const prompt = cli.requests[0]!.systemPrompt;
  expect(prompt).toContain("# Linked issues");
  expect(prompt).toContain("## #12 Slugify drops digits");
  expect(prompt).toContain("slugify('2nd') returns 'nd'.");
});

test("the Planner of a run on a task reads its story and epic under Part of", async () => {
  const { project, graphVersion } = await seedGraph(db, linear);
  const lineage = [
    { kind: "story" as const, number: 4, title: "Readable slugs", body: "Slugs keep what people typed." },
    { kind: "epic" as const, number: 2, title: "URLs", body: "Every page has a stable URL." },
  ];
  await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Fix the slugify issue", issues: [{ ...issue, lineage }] });
  const cli = new FakeCliExecutor([{ output: outputs.planner }]);
  await drain(engineDeps(db, { planner: cliNodeExecutor({ cli, maxTurns: 10, timeoutMs: 60_000 }), coder: scripted({ kind: "waiting", wait: { kind: "human", token: crypto.randomUUID() } }) }));
  const prompt = cli.requests[0]!.systemPrompt;
  expect(prompt).toContain("### Part of");
  expect(prompt).toContain('Story #4 "Readable slugs": Slugs keep what people typed.');
  expect(prompt).toContain('Epic #2 "URLs": Every page has a stable URL.');
});

test("the Coder reads the planner's acceptance criteria when the issue lists none", async () => {
  const { project, graphVersion } = await seedGraph(db, linear);
  await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Fix the slugify issue", issues: [issue] });
  const cli = new FakeCliExecutor([{ output: { ...outputs.planner, acceptance: ["slugify('2nd') returns '2nd'"] } }, { output: outputs.coderDone }]);
  const agent = cliNodeExecutor({ cli, maxTurns: 10, timeoutMs: 60_000 });
  await drain(engineDeps(db, { planner: agent, coder: agent, tester: scripted({ kind: "waiting", wait: { kind: "human", token: crypto.randomUUID() } }) }));
  const prompt = cli.requests[1]!.systemPrompt;
  expect(prompt).toContain("# Acceptance criteria");
  expect(prompt).toContain("- slugify('2nd') returns '2nd'");
});
