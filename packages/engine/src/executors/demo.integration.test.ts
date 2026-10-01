import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, expect, test } from "vitest";
import { FakeCliExecutor } from "@handoff/cli-adapter/testing";
import { eq, previews, screenshots } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { stopWorkerPreviews } from "../preview/preview.ts";
import { createRun } from "../runs.ts";
import { createOriginRepo } from "../testing/git.ts";
import { drain, engineDeps, inspect, seedGraph } from "../testing/harness.ts";
import { done, scripted } from "../testing/scripted.ts";
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

async function demoRun(cli: FakeCliExecutor, files: Record<string, string> = { ".claude/launch.json": launch, "app.js": app }) {
  const origin = createOriginRepo(files);
  const { project, graphVersion } = await seedGraph(db, graph, { localClonePath: origin });
  const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Tasks", issues: [issue] });
  const artifactsRoot = mkdtempSync(join(tmpdir(), "handoff-artifacts-"));
  const deps = engineDeps(
    db,
    {
      start: startExecutor(),
      finish: finishExecutor(),
      coder: scripted(done({ status: "done", summary: "Built it" })),
      demo: demoExecutor({ cli, maxTurns: 30, timeoutMs: 60_000, db, workerId: "test-worker", artifactsRoot }),
    },
    { workerId: "test-worker", workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }) },
  );
  await drain(deps);
  return { run, artifactsRoot };
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
  const { run } = await demoRun(cli, { "README.md": "no launch file" });
  const demo = (await inspect(db, run.id)).executions.find((e) => e.nodeKey === "demo")!;
  expect(demo).toMatchObject({ status: "failed", error: { code: "preview_failed", message: expect.stringContaining(".claude/launch.json") } });
  expect(cli.requests).toHaveLength(0);
});
