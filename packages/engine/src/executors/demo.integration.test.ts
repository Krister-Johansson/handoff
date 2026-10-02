import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeEach, expect, test } from "vitest";
import { FakeCliExecutor } from "@handoff/cli-adapter/testing";
import { eq, previews, projects, screenshots } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { stopWorkerPreviews, type DockerExec } from "../preview/preview.ts";
import { createRun } from "../runs.ts";
import { createOriginRepo } from "../testing/git.ts";
import { drain, engineDeps, inspect, seedGraph } from "../testing/harness.ts";
import { done } from "../testing/scripted.ts";
import type { NodeExecutor } from "../types.ts";
import { GitWorktreeProvider } from "../workdir/git-worktree.ts";
import { demoExecutor } from "./demo.ts";
import { finishExecutor, startExecutor } from "./flow.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterEach(() => stopWorkerPreviews(db, "test-worker"));
afterAll(() => db.$client.end());

const graph = {
  attributes: { startNode: "start" },
  nodes: [
    { key: "start", attributes: { type: "start", config: { trigger: "run" } } },
    { key: "coder", attributes: { type: "coder" } },
    { key: "demo", attributes: { type: "demo" } },
    { key: "finish", attributes: { type: "finish" } },
  ],
  edges: [
    { key: "start->coder", source: "start", target: "coder", attributes: { port: "run" } },
    { key: "coder->demo", source: "coder", target: "demo", attributes: { port: "done" } },
    { key: "demo->finish", source: "demo", target: "finish", attributes: { port: "done" } },
  ],
};

const launch = JSON.stringify({ version: "0.0.1", configurations: [{ name: "web", runtimeExecutable: "node", runtimeArgs: ["app.js"] }] });
const app = `require("node:http").createServer((_, res) => res.end("todo app")).listen(Number(process.env.PORT));`;
const issue = { number: 5, title: "Tasks", url: "https://github.com/octo/sample/issues/5", body: "- [ ] A user can create a new task" };

type McpConfig = { mcpServers: Record<string, { command: string; args: string[] }> };

type DemoRunOptions = {
  files?: Record<string, string>;
  document?: unknown;
  /** Files the coder writes in the worktree: the run's change. */
  writes?: Record<string, string>;
  project?: Partial<typeof projects.$inferInsert>;
  docker?: DockerExec;
};

/** A coder that writes `writes` into the run's worktree, as the run's change. */
function coderWriting(writes: Record<string, string>): NodeExecutor {
  return {
    needsWorkdir: true,
    async execute(ctx) {
      for (const [file, text] of Object.entries(writes)) {
        mkdirSync(dirname(join(ctx.workdir!.path, file)), { recursive: true });
        writeFileSync(join(ctx.workdir!.path, file), text);
      }
      return done({ status: "done", summary: "Built it" });
    },
  };
}

async function demoRun(cli: FakeCliExecutor, opts: DemoRunOptions = {}) {
  const origin = createOriginRepo(opts.files ?? { ".claude/launch.json": launch, "app.js": app });
  const { project, graphVersion } = await seedGraph(db, opts.document ?? graph, { localClonePath: origin });
  if (opts.project) await db.update(projects).set(opts.project).where(eq(projects.id, project.id));
  const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Tasks", issues: [issue] });
  const artifactsRoot = mkdtempSync(join(tmpdir(), "handoff-artifacts-"));
  const deps = engineDeps(
    db,
    {
      start: startExecutor(),
      finish: finishExecutor(),
      coder: coderWriting(opts.writes ?? {}),
      demo: demoExecutor({ cli, maxTurns: 30, timeoutMs: 60_000, db, workerId: "test-worker", artifactsRoot, ...(opts.docker ? { docker: opts.docker } : {}) }),
    },
    { workerId: "test-worker", workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }) },
  );
  await drain(deps);
  return { run, project, artifactsRoot };
}

test("a Demo step walks through the running app in a browser that can only reach it, and keeps its screenshots", async () => {
  const seen: { url?: string | undefined; page?: string; args?: string[]; tools?: string[] } = {};
  const cli = new FakeCliExecutor([
    async (request, options) => {
      const config = JSON.parse(readFileSync(request.mcpConfigPath!, "utf8")) as McpConfig;
      const playwright = config.mcpServers.playwright!;
      seen.args = playwright.args;
      seen.tools = request.allowedTools;
      seen.url = /running at (\S+?)\./.exec(request.systemPrompt)?.[1];
      seen.page = await (await fetch(seen.url!)).text();
      const outputDir = playwright.args[playwright.args.indexOf("--output-dir") + 1]!;
      writeFileSync(join(outputDir, "page-1.png"), "png bytes");
      await options.onSessionId?.(request.session.id);
      const output = {
        summary: "Created a task.",
        shots: [
          { file: "page-1.png", caption: "The new task in the list", criterion: "A user can create a new task", works: true },
          { file: "page-9.png", caption: "Never taken", works: true },
        ],
      };
      return { outcome: "success", exitCode: 0, stderrTail: "", sessionId: request.session.id, structuredOutput: output, validated: request.contract.parse(output) };
    },
  ]);
  const { run, artifactsRoot } = await demoRun(cli);
  expect(seen.page).toBe("todo app");
  expect(seen.args).toEqual(expect.arrayContaining(["--headless", "--isolated", "--allowed-origins"]));
  expect(seen.args![seen.args!.indexOf("--allowed-origins") + 1]).toContain(new URL(seen.url!).origin);
  expect(seen.tools).toContain("mcp__playwright");

  const { executions, run: row, events } = await inspect(db, run.id);
  expect(row.status).toBe("succeeded");
  const demo = executions.find((e) => e.nodeKey === "demo")!;
  const [shot] = await db.select().from(screenshots).where(eq(screenshots.runId, run.id));
  expect(shot).toMatchObject({ nodeExecutionId: demo.id, position: 0, caption: "The new task in the list", criterion: "A user can create a new task", works: true });
  expect(shot!.path.startsWith(join(artifactsRoot, run.id))).toBe(true);
  expect(readFileSync(shot!.path, "utf8")).toBe("png bytes");
  // A screenshot the agent named but never took is left out, and said so.
  expect((demo.output as { shots: unknown[] }).shots).toEqual([expect.objectContaining({ file: "page-1.png", artifactId: shot!.id })]);
  expect(events.find((e) => e.type === "demo.missing_shot")?.payload).toEqual({ file: "page-9.png" });
  // The app stops when the walk-through ends.
  expect((await db.select().from(previews).where(eq(previews.runId, run.id)))[0]!.status).toBe("stopped");
});

test("a Demo step fails, saying why, when the app does not start", async () => {
  const cli = new FakeCliExecutor([]);
  const { run } = await demoRun(cli, { files: { "README.md": "no launch file" } });
  const demo = (await inspect(db, run.id)).executions.find((e) => e.nodeKey === "demo")!;
  expect(demo).toMatchObject({ status: "failed", error: { code: "preview_failed", message: expect.stringContaining(".claude/launch.json") } });
  expect(cli.requests).toHaveLength(0);
});

/** A demo that runs only for changes to the UI: a change with none leaves through skipped, to the end. */
const uiGraph = {
  attributes: { startNode: "start" },
  nodes: [
    { key: "start", attributes: { type: "start", config: { trigger: "run" } } },
    { key: "coder", attributes: { type: "coder" } },
    { key: "demo", attributes: { type: "demo", config: { when: "ui_changes" } } },
    { key: "finish", attributes: { type: "finish" } },
    { key: "shipped", attributes: { type: "finish" } },
  ],
  edges: [
    { key: "start->coder", source: "start", target: "coder", attributes: { port: "run" } },
    { key: "coder->demo", source: "coder", target: "demo", attributes: { port: "done" } },
    { key: "demo->finish", source: "demo", target: "finish", attributes: { port: "done" } },
    { key: "demo->shipped", source: "demo", target: "shipped", attributes: { port: "skipped" } },
  ],
};

test("a change with no file under the UI paths leaves through skipped with the reason", async () => {
  const cli = new FakeCliExecutor([]);
  const { run } = await demoRun(cli, { document: uiGraph, writes: { "server/tasks.ts": "export const tasks = [];\n" } });
  const { run: row, executions, events } = await inspect(db, run.id);
  expect(row.status).toBe("succeeded");
  expect(executions.map((e) => e.nodeKey)).toEqual(["start", "coder", "demo", "shipped"]);
  const demo = executions.find((e) => e.nodeKey === "demo")!;
  expect(demo.output).toMatchObject({ skipped: true, reason: expect.stringContaining("server/tasks.ts"), shots: [] });
  expect(events.find((e) => e.type === "demo.skipped")?.payload).toEqual({ reason: (demo.output as { reason: string }).reason });
  // Nothing started: no app, no agent.
  expect(cli.requests).toHaveLength(0);
  expect(await db.select().from(previews).where(eq(previews.runId, run.id))).toEqual([]);
});

/** A walk-through that only reads the app's page, so a test can see what the app served. */
function readsTheApp(seen: { page?: string }) {
  return new FakeCliExecutor([
    async (request) => {
      const url = /running at (\S+?)\./.exec(request.systemPrompt)![1]!;
      seen.page = await (await fetch(url)).text();
      const output = { summary: "Looked at it.", shots: [] };
      return { outcome: "success", exitCode: 0, stderrTail: "", sessionId: request.session.id, structuredOutput: output, validated: request.contract.parse(output) };
    },
  ]);
}

test("the seed command runs after services start and before the app", async () => {
  const order = join(mkdtempSync(join(tmpdir(), "handoff-order-")), "order.log");
  const docker: DockerExec = async (args) => {
    if (args.includes("up")) writeFileSync(order, "services\n", { flag: "a" });
    return { exitCode: 0, output: "" };
  };
  const seeded = `require("node:fs").appendFileSync(${JSON.stringify(order)}, "app\\n"); require("node:http").createServer((_, res) => res.end(require("node:fs").readFileSync(${JSON.stringify(order)}, "utf8"))).listen(Number(process.env.PORT));`;
  const seen: { page?: string } = {};
  const { run } = await demoRun(readsTheApp(seen), {
    files: { ".claude/launch.json": launch, "app.js": seeded, "compose.yaml": "services: {}\n" },
    project: { demoSeedCommand: `echo seed >> ${order}` },
    docker,
  });
  expect((await inspect(db, run.id)).run.status).toBe("succeeded");
  expect(readFileSync(order, "utf8")).toBe("services\nseed\napp\n");
  expect(seen.page).toBe("services\nseed\napp\n");
});

test("a console error in the demo's output fails the step with the message", async () => {
  const cli = new FakeCliExecutor([
    async (request) => {
      const output = {
        summary: "The list did not render.",
        shots: [],
        console: [
          { level: "warning", text: "React does not recognize the `isActive` prop" },
          { level: "error", text: "Uncaught (in promise) TypeError: tasks.map is not a function" },
        ],
      };
      return { outcome: "success", exitCode: 0, stderrTail: "", sessionId: request.session.id, structuredOutput: output, validated: request.contract.parse(output) };
    },
  ]);
  const { run } = await demoRun(cli);
  const demo = (await inspect(db, run.id)).executions.find((e) => e.nodeKey === "demo")!;
  expect(demo).toMatchObject({ status: "failed", error: { code: "demo_console_errors", message: expect.stringContaining("Uncaught (in promise) TypeError: tasks.map is not a function") } });
  expect((demo.error as { message: string }).message).not.toContain("isActive");
});

test("the server log's and the console's warnings are in the output, marked new when the project's previous demo did not have them", async () => {
  // The app always warns about the old API; on the second run's change it also logs an error.
  const logging = `const fs = require("node:fs");
console.warn("Warning: the old API is deprecated (took 12ms)");
if (fs.existsSync("new.flag")) console.error("Error: could not load tasks");
console.log("listening");
require("node:http").createServer((_, res) => res.end("ok")).listen(Number(process.env.PORT));`;
  const walk = (consoleEntries: { level: string; text: string }[]) => async (request: { session: { id: string }; contract: { parse(v: unknown): unknown } }) => {
    const output = { summary: "Walked through.", shots: [], console: consoleEntries };
    return { outcome: "success" as const, exitCode: 0, stderrTail: "", sessionId: request.session.id, structuredOutput: output, validated: request.contract.parse(output) };
  };
  const cli = new FakeCliExecutor([
    walk([{ level: "warning", text: "Each child in a list should have a unique key prop" }]),
    walk([
      { level: "warning", text: "Each child in a list should have a unique key prop" },
      { level: "warning", text: "Image is missing an alt attribute" },
    ]),
  ]);
  const origin = createOriginRepo({ ".claude/launch.json": launch, "app.js": logging });
  const { project, graphVersion } = await seedGraph(db, graph, { localClonePath: origin });
  let calls = 0;
  const coder: NodeExecutor = {
    needsWorkdir: true,
    async execute(ctx) {
      if (++calls === 2) writeFileSync(join(ctx.workdir!.path, "new.flag"), "");
      return done({ status: "done", summary: "Built it" });
    },
  };
  const deps = engineDeps(
    db,
    {
      start: startExecutor(),
      finish: finishExecutor(),
      coder,
      demo: demoExecutor({ cli, maxTurns: 30, timeoutMs: 60_000, db, workerId: "test-worker", artifactsRoot: mkdtempSync(join(tmpdir(), "handoff-artifacts-")) }),
    },
    { workerId: "test-worker", workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }) },
  );
  const first = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Tasks", issues: [issue] });
  await drain(deps);
  const second = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Tasks", issues: [issue] });
  await drain(deps);

  const warningsOf = async (runId: string) => ((await inspect(db, runId)).executions.find((e) => e.nodeKey === "demo")!.output as { warnings: unknown[] }).warnings;
  // The project's first demo has nothing to compare with: everything is new.
  expect(await warningsOf(first.id)).toEqual([
    { source: "server", level: "warning", text: "Warning: the old API is deprecated (took 12ms)", new: true },
    { source: "console", level: "warning", text: "Each child in a list should have a unique key prop", new: true },
  ]);
  expect(await warningsOf(second.id)).toEqual([
    { source: "server", level: "warning", text: "Warning: the old API is deprecated (took 12ms)", new: false },
    { source: "server", level: "error", text: "Error: could not load tasks", new: true },
    { source: "console", level: "warning", text: "Each child in a list should have a unique key prop", new: false },
    { source: "console", level: "warning", text: "Image is missing an alt attribute", new: true },
  ]);
});

test("a passEnv variable reaches the app", async () => {
  process.env.HANDOFF_DEMO_TEST_KEY = "key-from-the-worker";
  try {
    const showsKey = `require("node:http").createServer((_, res) => res.end(process.env.HANDOFF_DEMO_TEST_KEY ?? "no key")).listen(Number(process.env.PORT));`;
    const document = structuredClone(graph);
    Object.assign(document.nodes.find((n) => n.key === "demo")!.attributes, { config: { passEnv: ["HANDOFF_DEMO_TEST_KEY"] } });
    const seen: { page?: string } = {};
    const { run } = await demoRun(readsTheApp(seen), { document, files: { ".claude/launch.json": launch, "app.js": showsKey } });
    expect((await inspect(db, run.id)).run.status).toBe("succeeded");
    expect(seen.page).toBe("key-from-the-worker");
  } finally {
    delete process.env.HANDOFF_DEMO_TEST_KEY;
  }
});
