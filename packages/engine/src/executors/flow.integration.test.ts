import { afterAll, beforeEach, expect, test } from "vitest";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub } from "@handoff/github/testing";
import { wakeDependents } from "../dependencies.ts";
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

test("a run whose issue GitHub says is blocked by an open issue waits at Start, and starts once the blocker is closed", async () => {
  const github = new FakeGitHub();
  github.issues.set(3, { number: 3, title: "F03 Prisma schema", url: "https://github.com/octo/sample/issues/3", body: "", state: "open" });
  github.issues.set(5, { number: 5, title: "F05 Theme tokens", url: "https://github.com/octo/sample/issues/5", body: "", state: "open", blockedBy: [3] });
  const issues = [{ number: 5, title: "F05 Theme tokens", url: "https://github.com/octo/sample/issues/5", body: "" }];
  const { project, run } = await startRun(db, graph(true), "F05 Theme tokens", issues);
  const deps = engineDeps(db, { ...registry, start: startExecutor({ github }) });
  await drain(deps);
  const waiting = await inspect(db, run.id);
  expect(waiting.run.status).toBe("waiting");
  expect(waiting.executions).toMatchObject([{ nodeKey: "start", status: "waiting", waitKey: `deps:${project.id}` }]);
  expect(waiting.events.find((e) => e.type === "run.blocked")?.payload).toEqual({ issue: 5, blockedBy: [3] });

  // #3's pull request merges and handoff closes the issue, which wakes the runs waiting on the project's dependencies.
  github.issues.get(3)!.state = "closed";
  await wakeDependents(db, project.id);
  await drain(deps);
  const started = await inspect(db, run.id);
  expect(started.run.status).toBe("succeeded");
  expect(started.executions[0]?.output).toMatchObject({ trigger: "run", issues: [{ number: 5 }] });
});
