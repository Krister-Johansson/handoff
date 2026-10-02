import { afterAll, beforeEach, expect, test } from "vitest";
import loop from "@handoff/core/fixtures/loop.graph.json" with { type: "json" };
import { eq, questions } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { finishExecutor, startExecutor } from "./executors/flow.ts";
import { humanGateExecutor } from "./executors/human-gate.ts";
import { answerQuestion } from "./operations.ts";
import { drain, engineDeps, inspect, startRun } from "./testing/harness.ts";
import { done, outputs, scripted } from "./testing/scripted.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

type Notify = Record<string, boolean> | undefined;

/** Start, a planner, a gate and Finish, each with the notification settings given. */
const graph = ({ start, planner, gate, finish }: { start?: Notify; planner?: Notify; gate?: Notify; finish?: Notify } = {}) => ({
  attributes: { startNode: "start" },
  nodes: [
    { key: "start", attributes: { type: "start", config: { trigger: "run" }, ...(start ? { notify: start } : {}) } },
    { key: "planner", attributes: { type: "planner", ...(planner ? { notify: planner } : {}) } },
    { key: "gate", attributes: { type: "human_gate", config: { question: "Ship it?" }, ...(gate ? { notify: gate } : {}) } },
    { key: "finish", attributes: { type: "finish", ...(finish ? { notify: finish } : {}) } },
  ],
  edges: [
    { key: "start->planner", source: "start", target: "planner", attributes: { port: "run" } },
    { key: "planner->gate", source: "planner", target: "gate", attributes: { port: "done" } },
    { key: "gate->finish", source: "gate", target: "finish", attributes: { port: "approve" } },
  ],
});

const registry = (planner = scripted(done(outputs.planner, { plan: outputs.planner }))) => ({
  start: startExecutor(),
  finish: finishExecutor(),
  planner,
  human_gate: humanGateExecutor({ db }),
});

const notifications = async (runId: string) =>
  (await inspect(db, runId)).events.filter((e) => e.type === "notify").map((e) => e.payload as { kind: string; nodeKey: string });

test("by default a gate tells a person it waits for them and Finish that the run finished; Start stays quiet", async () => {
  const { run, project } = await startRun(db, graph());
  await drain(engineDeps(db, registry()));
  const [question] = await db.select().from(questions).where(eq(questions.runId, run.id));
  const asked = { kind: "input", nodeKey: "gate", questionId: question!.id, title: `${project.name}: the plan from planner needs your review`, body: "Add a CHANGELOG.md" };
  expect(await notifications(run.id)).toEqual([asked]);

  await answerQuestion(db, question!.id, { answer: "approve", option: "approve", answeredBy: "krister" });
  await drain(engineDeps(db, registry()));
  expect(await notifications(run.id)).toEqual([asked, { kind: "finished", nodeKey: "finish", title: `${project.name}: run finished`, body: "Add a CHANGELOG.md" }]);
});

test("nodes notify only about what their settings turn on", async () => {
  const { run, project } = await startRun(db, graph({ start: { started: true }, gate: { input: false } }));
  await drain(engineDeps(db, registry()));
  expect(await notifications(run.id)).toEqual([{ kind: "started", nodeKey: "start", title: `${project.name}: run started`, body: "Add a CHANGELOG.md" }]);
});

test("a node that fails the run says so, unless its setting is off", async () => {
  const failing = () => scripted({ kind: "failed", error: { code: "boom", message: "planner broke" } });
  const { run, project } = await startRun(db, graph());
  await drain(engineDeps(db, registry(failing())));
  expect(await notifications(run.id)).toEqual([{ kind: "failed", nodeKey: "planner", reason: "node_failed", title: `${project.name}: run failed at planner`, body: "Add a CHANGELOG.md" }]);

  const quiet = await startRun(db, graph({ planner: { failed: false } }));
  await drain(engineDeps(db, registry(failing())));
  expect(await notifications(quiet.run.id)).toEqual([]);
});

test("a run that fails because a loop used its attempts says which step ran out of rounds", async () => {
  const { exhaustedGate: _gate, ...attributes } = loop.attributes;
  const { run, project } = await startRun(db, { ...loop, attributes });
  await drain(engineDeps(db, { planner: scripted(done(outputs.planner, { plan: outputs.planner })), coder: scripted(done(outputs.coderDone)), tester: scripted(done(outputs.testsFail)) }));
  expect((await inspect(db, run.id)).run.status).toBe("failed");
  expect(await notifications(run.id)).toEqual([{ kind: "failed", nodeKey: "tester", reason: "loop_exhausted", title: `${project.name}: tester ran out of rounds`, body: "Add a CHANGELOG.md" }]);
});

test("a notification's body is the run's task on one line, cut to 140 characters", async () => {
  const task = `Add a CHANGELOG.md\n\n${"It lists every release with its date and what changed. ".repeat(4)}`;
  const { run } = await startRun(db, graph({ start: { started: true }, gate: { input: false } }), task);
  await drain(engineDeps(db, registry()));
  const [started] = (await notifications(run.id)) as unknown as { body: string }[];
  expect(started!.body).toMatch(/^Add a CHANGELOG\.md It lists every release .*…$/);
  expect(started!.body.length).toBeLessThanOrEqual(140);
});

test("Finish's earlier notify switch still decides whether the run's end is news", async () => {
  const document = graph();
  document.nodes[3]!.attributes = { type: "finish", config: { notify: false } } as never;
  const { run } = await startRun(db, document);
  const deps = engineDeps(db, registry());
  await drain(deps);
  const [question] = await db.select().from(questions).where(eq(questions.runId, run.id));
  await answerQuestion(db, question!.id, { answer: "approve", option: "approve", answeredBy: "krister" });
  await drain(deps);
  expect((await notifications(run.id)).map((n) => n.kind)).toEqual(["input"]);
  expect((await inspect(db, run.id)).events.find((e) => e.type === "run.finish")?.payload).toEqual({ notify: false });
});
