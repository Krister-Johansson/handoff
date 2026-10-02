import { afterAll, beforeEach, expect, test } from "vitest";
import loop from "@handoff/core/fixtures/loop.graph.json" with { type: "json" };
import { asc, eq, notifications, questions } from "@handoff/db";
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

/** What the run told a person, oldest first, as each sender wrote it. */
const told = async (runId: string) =>
  (await db.select().from(notifications).where(eq(notifications.runId, runId)).orderBy(asc(notifications.createdAt))).map(({ tone, title, body, href, projectId }) => ({ tone, title, body, href, projectId }));

test("by default a gate tells a person it waits for them and Finish that the run finished; Start stays quiet", async () => {
  const { run, project } = await startRun(db, graph());
  await drain(engineDeps(db, registry()));
  const [question] = await db.select().from(questions).where(eq(questions.runId, run.id));
  const page = `/projects/${project.id}/runs/${run.id}`;
  const asked = { tone: "attention", title: `${project.name}: the plan from planner needs your review`, body: "Add a CHANGELOG.md", href: `${page}/review/${question!.id}`, projectId: project.id };
  expect(await told(run.id)).toEqual([asked]);

  await answerQuestion(db, question!.id, { answer: "approve", option: "approve", answeredBy: "krister" });
  await drain(engineDeps(db, registry()));
  // Answering changes the question; its notification stays as it was written.
  expect(await told(run.id)).toEqual([asked, { tone: "success", title: `${project.name}: run finished`, body: "Add a CHANGELOG.md", href: page, projectId: project.id }]);
});

test("a notification is its own row, not an event in the run's log", async () => {
  const { run } = await startRun(db, graph({ start: { started: true } }));
  await drain(engineDeps(db, registry()));
  expect(await told(run.id)).toHaveLength(2);
  expect((await inspect(db, run.id)).types).not.toContain("notify");
});

test("nodes notify only about what their settings turn on", async () => {
  const { run, project } = await startRun(db, graph({ start: { started: true }, gate: { input: false } }));
  await drain(engineDeps(db, registry()));
  expect(await told(run.id)).toEqual([{ tone: "neutral", title: `${project.name}: run started`, body: "Add a CHANGELOG.md", href: `/projects/${project.id}/runs/${run.id}`, projectId: project.id }]);
});

test("a node that fails the run says so, unless its setting is off", async () => {
  const failing = () => scripted({ kind: "failed", error: { code: "boom", message: "planner broke" } });
  const { run, project } = await startRun(db, graph());
  await drain(engineDeps(db, registry(failing())));
  expect(await told(run.id)).toEqual([{ tone: "danger", title: `${project.name}: run failed at planner`, body: "Add a CHANGELOG.md", href: `/projects/${project.id}/runs/${run.id}`, projectId: project.id }]);

  const quiet = await startRun(db, graph({ planner: { failed: false } }));
  await drain(engineDeps(db, registry(failing())));
  expect(await told(quiet.run.id)).toEqual([]);
});

test("a run that fails because a loop used its attempts says which step ran out of rounds", async () => {
  const { exhaustedGate: _gate, ...attributes } = loop.attributes;
  const { run, project } = await startRun(db, { ...loop, attributes });
  await drain(engineDeps(db, { planner: scripted(done(outputs.planner, { plan: outputs.planner })), coder: scripted(done(outputs.coderDone)), tester: scripted(done(outputs.testsFail)) }));
  expect((await inspect(db, run.id)).run.status).toBe("failed");
  expect(await told(run.id)).toMatchObject([{ tone: "danger", title: `${project.name}: tester ran out of rounds`, body: "Add a CHANGELOG.md" }]);
});

test("a notification's body is the run's task on one line, cut to 140 characters", async () => {
  const task = `Add a CHANGELOG.md\n\n${"It lists every release with its date and what changed. ".repeat(4)}`;
  const { run } = await startRun(db, graph({ start: { started: true }, gate: { input: false } }), task);
  await drain(engineDeps(db, registry()));
  const [started] = await told(run.id);
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
  expect((await told(run.id)).map((n) => n.tone)).toEqual(["attention"]);
  expect((await inspect(db, run.id)).events.find((e) => e.type === "run.finish")?.payload).toEqual({ notify: false });
});
