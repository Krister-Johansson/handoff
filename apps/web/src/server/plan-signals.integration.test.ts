import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { appendEvents, eq, questions, runs } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs";
import { planSignals } from "./plan-signals";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("planSignals lists the project's runs that wait on a person and why each task's latest status write was skipped", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  const other = await createProject(db, { name: "other", repo: "octo/other", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  await saveGraphVersion(db, { projectId: other.id, name: "g", document: linear });
  const start = (projectId: string, task: string) => startRunFromGraph(db, { projectId, graphName: "g", task });

  const asking = await start(project.id, "Pick a license");
  const ask = await seedExecution(db, asking.id, { nodeKey: "ask", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  await db.insert(questions).values({ runId: asking.id, nodeExecutionId: ask.id, question: "Which license?", context: { reason: "needs_input" } });
  await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, asking.id));
  const broken = await start(project.id, "Add a CHANGELOG.md");
  await seedExecution(db, broken.id, { nodeKey: "coder", status: "failed", error: { code: "TESTS_FAILED", message: "2 of 41 tests failed" } });
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, broken.id));
  const elsewhere = await start(other.id, "Elsewhere");
  const gate = await seedExecution(db, elsewhere.id, { nodeKey: "ask", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  await db.insert(questions).values({ runId: elsewhere.id, nodeExecutionId: gate.id, question: "?", context: { reason: "needs_input" } });
  await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, elsewhere.id));
  const quiet = await start(project.id, "Quiet");

  await db.transaction((tx) =>
    appendEvents(tx, asking.id, [
      { type: "plan.skipped", payload: { issue: 57, status: "Running", reason: "not-in-project" } },
      { type: "plan.skipped", payload: { issue: 58, status: "Running", reason: "no-access" } },
    ]),
  );
  await db.transaction((tx) => appendEvents(tx, quiet.id, [{ type: "plan.skipped", payload: { issue: 59, status: "Running", reason: "no-option" } }, { type: "plan.status", payload: { issue: 59, status: "Running" } }]));

  const signals = await planSignals(db, project.id, [
    { number: 57, run: { id: asking.id } },
    { number: 59, run: { id: quiet.id } },
    { number: 60, run: null },
  ]);
  expect(signals.needsYou.sort()).toEqual([asking.id, broken.id].sort());
  expect(signals.skipped).toEqual({ 57: "#57 not moved to Running: not in the plan's Project" });
});
