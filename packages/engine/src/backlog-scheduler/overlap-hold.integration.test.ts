import { afterAll, beforeEach, expect, test } from "vitest";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { eq, nodeExecutions, runs, sql, type Db } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { createRun } from "../runs.ts";
import { drain, engineDeps, inspect, seedGraph } from "../testing/harness.ts";
import { done, outputs, scripted } from "../testing/scripted.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

type Seeded = Awaited<ReturnType<typeof seedGraph>>;

const plan = (ownedPaths: string[]) => ({ plan: "p", steps: ["s"], ownedPaths });

/** A run of the project that already has a plan and waits at a gate, so it stays active while the test runs. */
async function activeRun(db: Db, seeded: Seeded, ownedPaths: string[], startedBy = "dashboard") {
  const run = await createRun(db, { projectId: seeded.project.id, graphVersionId: seeded.graphVersion.id, task: "Board columns", startedBy });
  await db
    .update(runs)
    .set({ status: "waiting", state: sql`${runs.state} || ${JSON.stringify({ plan: plan(ownedPaths) })}::jsonb` })
    .where(eq(runs.id, run.id));
  await db.update(nodeExecutions).set({ status: "waiting", waitKind: "human" }).where(eq(nodeExecutions.runId, run.id));
  return run;
}

/** Executors for a run whose planner owns the given paths; the coder records that it ran. */
function planning(ownedPaths: string[]) {
  return { planner: scripted(done(plan(ownedPaths), { plan: plan(ownedPaths) })), coder: scripted(done(outputs.coderDone)) };
}

test("a scheduler-started run whose plan shares paths with an active run waits before its coder, naming the run and the paths", async () => {
  const seeded = await seedGraph(db, linear);
  const other = await activeRun(db, seeded, ["apps/board", "package.json"]);
  const held = await createRun(db, { projectId: seeded.project.id, graphVersionId: seeded.graphVersion.id, task: "Card drag", startedBy: "scheduler" });
  const executors = planning(["apps/board/card.tsx", "apps/api/route.ts", "pnpm-lock.yaml"]);

  await drain(engineDeps(db, executors));

  expect(executors.coder.calls).toHaveLength(0);
  const { run, executions, events } = await inspect(db, held.id);
  expect(run.status).toBe("waiting");
  const coder = executions.find((e) => e.nodeKey === "coder")!;
  expect(coder).toMatchObject({ status: "waiting", waitKind: "timer", waitKey: `overlap:${seeded.project.id}`, attempt: 1 });
  // The recheck comes in about ten minutes.
  expect(coder.waitDeadlineAt!.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
  expect(events.find((e) => e.type === "run.overlap_held")?.payload).toEqual({
    nodeKey: "coder",
    runId: other.id,
    paths: ["apps/board/card.tsx", "pnpm-lock.yaml"],
  });
});
