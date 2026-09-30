import { afterAll, beforeEach, expect, test } from "vitest";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { drain, engineDeps, inspect, startRun } from "../testing/harness.ts";
import { done, outputs, scripted } from "../testing/scripted.ts";
import { finishExecutor, startExecutor } from "./flow.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const graph = (notify: boolean) => ({
  attributes: { startNode: "start" },
  nodes: [
    { key: "start", attributes: { type: "start", config: { trigger: "run" }, x: 0, y: 0 } },
    { key: "planner", attributes: { type: "planner", x: 0, y: 0 } },
    { key: "finish", attributes: { type: "finish", config: { notify }, x: 0, y: 0 } },
  ],
  edges: [
    { key: "start->planner", source: "start", target: "planner", attributes: { port: "run" } },
    { key: "planner->finish", source: "planner", target: "finish", attributes: { port: "done" } },
  ],
});

const registry = { start: startExecutor(), finish: finishExecutor(), planner: scripted(done(outputs.planner, { plan: outputs.planner })) };

test("a run starts at Start with the task and linked issues, and ends at Finish, which says whether to notify", async () => {
  const issues = [{ number: 15, title: "Add a truncate helper", url: "https://github.com/octo/sample/issues/15", body: "Cut at a word." }];
  const { run } = await startRun(db, graph(true), "Add a truncate helper", issues);
  await drain(engineDeps(db, registry));
  const { run: row, executions, events } = await inspect(db, run.id);
  expect(row.status).toBe("succeeded");
  expect(executions.map((e) => [e.nodeKey, e.status])).toEqual([
    ["start", "passed"],
    ["planner", "passed"],
    ["finish", "passed"],
  ]);
  expect(executions[0]?.output).toEqual({ trigger: "run", task: "Add a truncate helper", issues: [{ number: 15, title: "Add a truncate helper", url: "https://github.com/octo/sample/issues/15" }] });
  expect(events.find((e) => e.type === "run.finish")?.payload).toEqual({ notify: true });
});

test("a Finish node without notify still ends the run and records that it did not notify", async () => {
  const { run } = await startRun(db, graph(false));
  await drain(engineDeps(db, registry));
  const { run: row, events } = await inspect(db, run.id);
  expect(row.status).toBe("succeeded");
  expect(events.find((e) => e.type === "run.finish")?.payload).toEqual({ notify: false });
});
