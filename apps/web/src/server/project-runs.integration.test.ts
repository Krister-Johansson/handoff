import { afterAll, beforeEach, expect, test } from "vitest";
import { runs } from "@handoff/db";
import { createTestDb, seedRun, truncateAll } from "@handoff/db/testing";
import type { RunStatusName } from "@/lib/run-status-filter";
import { projectRuns } from "./project-runs.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

/** A project with one run in each status, the newest last, and another project's waiting run. */
async function seed() {
  const { project, run: first } = await seedRun(db, { status: "queued" });
  const ids: Record<string, string> = { queued: first.id };
  const statuses: RunStatusName[] = ["running", "waiting", "succeeded", "failed", "cancelled"];
  for (const [i, status] of statuses.entries()) {
    const [run] = await db
      .insert(runs)
      .values({
        projectId: project.id,
        graphVersionId: first.graphVersionId,
        status,
        task: status,
        state: { task: status, loops: {}, nodes: {}, human: {} },
        baseBranch: "main",
        branchName: `handoff/${status}`,
        createdAt: new Date(Date.now() + (i + 1) * 1000),
      })
      .returning();
    ids[status] = run!.id;
  }
  await seedRun(db, { status: "waiting" });
  return { projectId: project.id, ids };
}

test("without a filter the project's runs are listed newest first, with a count for each filter", async () => {
  const { projectId, ids } = await seed();
  const { runs: listed, counts } = await projectRuns(db, projectId);
  expect(listed.map((r) => r.id)).toEqual([ids.cancelled, ids.failed, ids.succeeded, ids.waiting, ids.running, ids.queued]);
  expect(counts).toEqual({ all: 6, active: 2, waiting: 1, failed: 1, done: 2 });
});

test("a filter lists its statuses only: Active is queued and running, Done is succeeded and cancelled", async () => {
  const { projectId, ids } = await seed();
  expect((await projectRuns(db, projectId, "active")).runs.map((r) => r.id)).toEqual([ids.running, ids.queued]);
  expect((await projectRuns(db, projectId, "waiting")).runs.map((r) => r.id)).toEqual([ids.waiting]);
  expect((await projectRuns(db, projectId, "failed")).runs.map((r) => r.id)).toEqual([ids.failed]);
  const done = await projectRuns(db, projectId, "done");
  expect(done.runs.map((r) => r.id)).toEqual([ids.cancelled, ids.succeeded]);
  // The counts stay those of the whole project.
  expect(done.counts.all).toBe(6);
});
