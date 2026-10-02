import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, expect, test } from "vitest";
import { eq, previews, questions } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { answerQuestion, restartTryIt } from "../operations.ts";
import { createRun } from "../runs.ts";
import { stopPreview, stopWorkerPreviews } from "../preview/preview.ts";
import { createOriginRepo } from "../testing/git.ts";
import { drain, engineDeps, inspect, seedGraph } from "../testing/harness.ts";
import { done, scripted } from "../testing/scripted.ts";
import { GitWorktreeProvider } from "../workdir/git-worktree.ts";
import { finishExecutor, startExecutor } from "./flow.ts";
import { humanGateExecutor } from "./human-gate.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterEach(() => stopWorkerPreviews(db, "test-worker"));
afterAll(() => db.$client.end());

const graph = {
  attributes: { startNode: "start" },
  nodes: [
    { key: "start", attributes: { type: "start", config: { trigger: "run" } } },
    { key: "coder", attributes: { type: "coder" } },
    { key: "try", attributes: { type: "human_gate", label: "Try it", config: { mode: "try" } } },
    { key: "finish", attributes: { type: "finish" } },
  ],
  edges: [
    { key: "start->coder", source: "start", target: "coder", attributes: { port: "run" } },
    { key: "coder->try", source: "coder", target: "try", attributes: { port: "done" } },
    { key: "try->finish", source: "try", target: "finish", attributes: { port: "approve" } },
    { key: "try->coder", source: "try", target: "coder", attributes: { port: "changes", input: "feedback" } },
  ],
};

const launch = JSON.stringify({ version: "0.0.1", configurations: [{ name: "web", runtimeExecutable: "node", runtimeArgs: ["app.js"] }] });
const app = `require("node:http").createServer((_, res) => res.end("todo app")).listen(Number(process.env.PORT));`;
const issue = { number: 5, title: "Tasks", url: "https://github.com/octo/sample/issues/5", body: "## Acceptance criteria\n- [ ] A user can create a new task" };

async function tryRun(files: Record<string, string> = { ".claude/launch.json": launch, "app.js": app }) {
  const origin = createOriginRepo(files);
  const { project, graphVersion } = await seedGraph(db, graph, { localClonePath: origin });
  const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Tasks", issues: [issue] });
  const deps = engineDeps(
    db,
    { start: startExecutor(), finish: finishExecutor(), coder: scripted(done({ status: "done", summary: "Built it" })), human_gate: humanGateExecutor({ db, workerId: "test-worker" }) },
    { workerId: "test-worker", workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }) },
  );
  await drain(deps);
  const [question] = await db.select().from(questions).where(eq(questions.runId, run.id));
  return { run, deps, question: question! };
}

const previewOf = async (runId: string) => (await db.select().from(previews).where(eq(previews.runId, runId)))[0];

test("a Try it gate starts the run's app and asks the person to check each acceptance criterion in it", async () => {
  const { run, question } = await tryRun();
  const preview = (await previewOf(run.id))!;
  expect(preview).toMatchObject({ status: "running", configuration: "web" });
  expect(await (await fetch(`http://127.0.0.1:${preview.port}`)).text()).toBe("todo app");
  expect(question).toMatchObject({ options: ["approve", "changes"], answer: null });
  expect(question.context).toEqual({ reason: "try", acceptance: ["A user can create a new task"], preview: { id: preview.id, url: preview.url, status: "running" } });
  const { executions, events } = await inspect(db, run.id);
  expect(executions.find((e) => e.nodeKey === "try")).toMatchObject({ status: "waiting", waitKind: "human" });
  expect(events.find((e) => e.type === "notify")?.payload).toMatchObject({ kind: "input", nodeKey: "try", questionId: question.id, title: expect.stringMatching(/: the app is ready for you to try$/), body: "Tasks" });
});

test("answering stops the app and goes on, and a failed item goes back to the coder", async () => {
  const { run, deps, question } = await tryRun();
  await answerQuestion(db, question.id, { answer: "One item fails", option: "changes", answeredBy: "krister", comments: [{ quote: "A user can create a new task", body: "The Add button does nothing" }] });
  await drain(deps);
  expect((await previewOf(run.id))!.status).toBe("stopped");
  const { executions } = await inspect(db, run.id);
  expect(executions.filter((e) => e.nodeKey === "coder")).toHaveLength(2);
});

test("an app that cannot start still lets the person answer, with the reason in the question", async () => {
  const { question } = await tryRun({ "README.md": "no launch file" });
  expect(question.context).toMatchObject({ reason: "try", preview: { status: "failed", error: expect.stringContaining(".claude/launch.json") } });
});

test("restarting a Try it gate starts its app again when it stopped", async () => {
  const { run, deps, question } = await tryRun();
  const first = (await previewOf(run.id))!;
  await stopPreview(db, first.id);
  await restartTryIt(db, question.id);
  await drain(deps);
  const running = (await db.select().from(previews).where(eq(previews.runId, run.id))).filter((p) => p.status === "running");
  expect(running).toHaveLength(1);
  const [updated] = await db.select().from(questions).where(eq(questions.id, question.id));
  expect(updated!.context).toMatchObject({ preview: { id: running[0]!.id, status: "running" } });
  expect(updated!.answer).toBeNull();
});

test("a Try it gate after a Demo shows its screenshots next to the criteria", async () => {
  const withDemo = {
    ...graph,
    nodes: [...graph.nodes, { key: "demo", attributes: { type: "demo" } }],
    edges: [
      graph.edges[0]!,
      { key: "coder->demo", source: "coder", target: "demo", attributes: { port: "done" } },
      { key: "demo->try", source: "demo", target: "try", attributes: { port: "done" } },
      ...graph.edges.slice(2),
    ],
  };
  const origin = createOriginRepo({ ".claude/launch.json": launch, "app.js": app });
  const { project, graphVersion } = await seedGraph(db, withDemo, { localClonePath: origin });
  const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Tasks", issues: [issue] });
  const shot = { file: "page-1.png", caption: "The new task in the list", criterion: "A user can create a new task", works: true, artifactId: "9f1c2d3e-0000-4000-8000-000000000001" };
  await drain(
    engineDeps(
      db,
      {
        start: startExecutor(),
        finish: finishExecutor(),
        coder: scripted(done({ status: "done", summary: "Built it" })),
        demo: scripted(done({ summary: "Walked through it.", shots: [shot] })),
        human_gate: humanGateExecutor({ db, workerId: "test-worker" }),
      },
      { workerId: "test-worker", workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }) },
    ),
  );
  const [question] = await db.select().from(questions).where(eq(questions.runId, run.id));
  expect(question!.context).toMatchObject({ shots: [{ id: shot.artifactId, caption: shot.caption, criterion: shot.criterion, works: true }] });
});
