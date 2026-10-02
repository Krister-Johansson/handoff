import { afterAll, beforeEach, expect, test } from "vitest";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { eq, nodeExecutions, runs, sql, wakeByKey, type Db } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { cancelRun } from "../operations.ts";
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

test("a run a person started is not held", async () => {
  const seeded = await seedGraph(db, linear);
  await activeRun(db, seeded, ["apps/board"], "scheduler");
  const mine = await createRun(db, { projectId: seeded.project.id, graphVersionId: seeded.graphVersion.id, task: "Card drag", startedBy: "dashboard" });
  // A run from before runs recorded who started them is a person's too.
  const older = await createRun(db, { projectId: seeded.project.id, graphVersionId: seeded.graphVersion.id, task: "Card colors" });
  const executors = planning(["apps/board/card.tsx"]);

  await drain(engineDeps(db, executors));

  expect(executors.coder.calls.map((c) => c.run.id).sort()).toEqual([mine.id, older.id].sort());
  for (const run of [mine, older]) expect((await inspect(db, run.id)).types).not.toContain("run.overlap_held");
});

test("a held run does not take the Claude slot", async () => {
  const seeded = await seedGraph(db, linear);
  await activeRun(db, seeded, ["apps/board"]);
  const held = await createRun(db, { projectId: seeded.project.id, graphVersionId: seeded.graphVersion.id, task: "Card drag", startedBy: "scheduler" });
  const executors = {
    planner: scripted((ctx) => (ctx.run.id === held.id ? done(plan(["apps/board/card.tsx"]), { plan: plan(["apps/board/card.tsx"]) }) : done(plan(["docs"]), { plan: plan(["docs"]) }))),
    coder: scripted(done(outputs.coderDone)),
  };
  // One Claude process at a time, as HANDOFF_CAP_CLI defaults to.
  const deps = engineDeps(db, executors, { caps: { cli: 1, shell: 4, github: 4, human: 100, function: 8 } });
  await drain(deps);
  expect((await inspect(db, held.id)).executions.find((e) => e.nodeKey === "coder")?.status).toBe("waiting");

  const other = await createRun(db, { projectId: seeded.project.id, graphVersionId: seeded.graphVersion.id, task: "Docs", startedBy: "scheduler" });
  await drain(deps);

  expect(executors.planner.calls.map((c) => c.run.id)).toEqual([held.id, other.id]);
  expect(executors.coder.calls.map((c) => c.run.id)).toEqual([other.id]);
  const [running] = await db.select({ n: sql<number>`count(*)::int` }).from(nodeExecutions).where(eq(nodeExecutions.status, "running"));
  expect(running!.n).toBe(0);
});

test("the held run's coder starts when the other run ends", async () => {
  // A run a person cancels.
  const seeded = await seedGraph(db, linear);
  const cancelled = await activeRun(db, seeded, ["apps/board"]);
  const held = await createRun(db, { projectId: seeded.project.id, graphVersionId: seeded.graphVersion.id, task: "Card drag", startedBy: "scheduler" });
  const executors = planning(["apps/board/card.tsx"]);
  const deps = engineDeps(db, executors);
  await drain(deps);
  expect(executors.coder.calls).toHaveLength(0);

  await cancelRun(db, cancelled.id);
  await drain(deps);
  expect(executors.coder.calls.map((c) => c.run.id)).toEqual([held.id]);

  // A run that finishes its last step.
  await truncateAll(db);
  const again = await seedGraph(db, linear);
  const finishing = await activeRun(db, again, ["apps/board"]);
  await db
    .update(nodeExecutions)
    .set({ nodeKey: "merge", nodeType: "merge", executorKind: "github", waitKind: "merge_queue", waitKey: "mq:test" })
    .where(eq(nodeExecutions.runId, finishing.id));
  const waits = await createRun(db, { projectId: again.project.id, graphVersionId: again.graphVersion.id, task: "Card drag", startedBy: "scheduler" });
  const next = { ...planning(["apps/board/card.tsx"]), merge: scripted(done({ merged: true })) };
  const nextDeps = engineDeps(db, next);
  await drain(nextDeps);
  expect(next.coder.calls).toHaveLength(0);

  await wakeByKey(db, "mq:test", { reason: "merge_queue" });
  await drain(nextDeps);
  expect((await inspect(db, finishing.id)).run.status).toBe("succeeded");
  expect(next.coder.calls.map((c) => c.run.id)).toEqual([waits.id]);
});
