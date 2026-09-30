import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { appendEvents, eq, events as eventsTable } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { latestSeq, listExecutionCliEvents } from "./execution-events";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("an execution's Claude CLI events come back in order, the latest ones when there are many", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Build it" });
  const coder = await seedExecution(db, run.id, { nodeKey: "coder" });
  const other = await seedExecution(db, run.id, { nodeKey: "reviewer", nodeType: "reviewer" });
  await db.transaction((tx) =>
    appendEvents(tx, run.id, [
      { type: "node.claimed", payload: {}, nodeExecutionId: coder.id },
      { type: "cli.assistant", payload: { n: 1 }, nodeExecutionId: coder.id },
      { type: "cli.assistant", payload: { n: 2 }, nodeExecutionId: other.id },
      { type: "cli.user", payload: { n: 3 }, nodeExecutionId: coder.id },
      { type: "cli.result.success", payload: { n: 4 }, nodeExecutionId: coder.id },
    ]),
  );
  const events = await listExecutionCliEvents(db, run.id, coder.id);
  expect(events.map((e) => [e.type, (e.payload as { n: number }).n])).toEqual([
    ["cli.assistant", 1],
    ["cli.user", 3],
    ["cli.result.success", 4],
  ]);
  expect((await listExecutionCliEvents(db, run.id, coder.id, 2)).map((e) => (e.payload as { n: number }).n)).toEqual([3, 4]);
  expect(await listExecutionCliEvents(db, crypto.randomUUID(), coder.id)).toEqual([]);
  // A page that opens now follows the stream from the run's last event.
  const all = await db.select({ seq: eventsTable.seq }).from(eventsTable).where(eq(eventsTable.runId, run.id));
  expect(await latestSeq(db, run.id)).toBe(Math.max(...all.map((e) => Number(e.seq))));
  expect(await latestSeq(db, crypto.randomUUID())).toBe(0);
});
