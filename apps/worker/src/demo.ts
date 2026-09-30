/**
 * Seeds a demo project and drives one linear run with simulated Claude CLI events, so the dashboard
 * has something live to show before GitHub and a real `claude` are configured. No model calls.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import type { CliExecutor, CliRunRequest, CliRunOptions, CliRunResult } from "@handoff/cli-adapter";
import { createDb, deleteProject, graphs, graphVersions, projects, wakeByKey, eq } from "@handoff/db";
import { cliNodeExecutor, createRun, startWorker, type NodeExecutor } from "@handoff/engine";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const db = createDb(url);

const scripts: Record<string, { steps: unknown[]; output: unknown }> = {
  planner: {
    steps: [
      { type: "text", text: "Reading the repository layout." },
      { type: "tool_use", name: "Glob", input: { pattern: "**/*.md" } },
      { type: "text", text: "The change is a single new file at the root." },
    ],
    output: { plan: "Add CHANGELOG.md with an Unreleased section dated today.", steps: ["Create CHANGELOG.md", "Commit"], ownedPaths: ["CHANGELOG.md"] },
  },
  coder: {
    steps: [
      { type: "text", text: "Creating CHANGELOG.md following Keep a Changelog." },
      { type: "tool_use", name: "Write", input: { file_path: "CHANGELOG.md" } },
      { type: "tool_use", name: "Bash", input: { command: "git add CHANGELOG.md && git commit -m 'Add changelog'" } },
      { type: "text", text: "Committed the new file." },
    ],
    output: { status: "done", summary: "Added CHANGELOG.md and committed it.", filesChanged: ["CHANGELOG.md"] },
  },
};

class DemoCli implements CliExecutor {
  async run(request: CliRunRequest, options: CliRunOptions): Promise<CliRunResult> {
    const node = request.session.mode === "new" ? request.session.name.split("-").at(-2)! : "coder";
    const script = scripts[node]!;
    const sessionId = request.session.id;
    await options.onSessionId?.(sessionId);
    await options.onEvent({ type: "cli.system.init", payload: { type: "system", subtype: "init", session_id: sessionId, model: "claude-opus-5-5" } });
    for (const block of script.steps) {
      await sleep(900);
      await options.onEvent({ type: "cli.assistant", payload: { type: "assistant", message: { content: [block] } } });
    }
    await sleep(600);
    await options.onEvent({ type: "cli.result.success", payload: { type: "result", subtype: "success", num_turns: script.steps.length, total_cost_usd: 0.04 } });
    return { outcome: "success", exitCode: 0, stderrTail: "", sessionId, validated: script.output, structuredOutput: script.output, costUsd: 0.04 };
  }
}

const prOutput = {
  prNumber: 1,
  prUrl: "https://github.com/demo/sample/pull/1",
  headSha: "0000000",
  feedback: { ci: { status: "success", failedJobs: [] }, review: { decision: "approved", comments: [], unresolvedThreads: 0 }, updatedAt: new Date().toISOString() },
};

const pr: NodeExecutor = {
  needsWorkdir: false,
  async execute(ctx) {
    if (ctx.execution.wakeReason) return { kind: "completed", output: prOutput, statePatch: { prNumber: 1, feedback: prOutput.feedback } };
    ctx.emit("github.pr_opened", { number: 1, url: prOutput.prUrl });
    return { kind: "waiting", wait: { kind: "github_pr", key: "demo:pr:1" } };
  },
};

const merge: NodeExecutor = {
  needsWorkdir: false,
  async execute() {
    await sleep(800);
    return { kind: "completed", output: { merged: true, sha: "1111111" } };
  },
};

async function seed() {
  if (process.argv.includes("--reset")) {
    for (const p of await db.select().from(projects).where(eq(projects.isDemo, true))) await deleteProject(db, p.id);
    console.log("removed demo projects");
  }
  let [project] = await db.select().from(projects).where(eq(projects.name, "demo"));
  project ??= (await db.insert(projects).values({ name: "demo", repoOwner: "demo", repoName: "sample", defaultBranch: "main", isDemo: true }).returning())[0]!;
  let [graph] = await db.select().from(graphs).where(eq(graphs.projectId, project.id));
  graph ??= (await db.insert(graphs).values({ projectId: project.id, name: "linear", latestVersion: 1 }).returning())[0]!;
  let [version] = await db.select().from(graphVersions).where(eq(graphVersions.graphId, graph.id));
  version ??= (await db.insert(graphVersions).values({ graphId: graph.id, version: 1, document: linear as Record<string, unknown> }).returning())[0]!;
  return { project, version };
}

const { project, version } = await seed();
const run = await createRun(db, { projectId: project.id, graphVersionId: version.id, task: "Add a CHANGELOG.md with today's date" });
console.log(`demo run ${run.id}`);
console.log(`open http://localhost:${process.env.WEB_PORT ?? 3000}/runs/${run.id}`);

const cli = cliNodeExecutor({ cli: new DemoCli(), maxTurns: 30, timeoutMs: 60_000 });
const worker = startWorker(
  {
    db,
    workerId: "demo",
    caps: { cli: 1, shell: 4, github: 4, human: 100, function: 8 },
    leaseMs: 30_000,
    executors: { planner: cli, coder: cli, pr, merge },
    workdirs: { acquire: async () => ({ path: mkdtempSync(join(tmpdir(), "handoff-demo-")), baseSha: "0" }), release: async () => {} },
    stagingRoot: mkdtempSync(join(tmpdir(), "handoff-demo-staging-")),
  },
  { pollIntervalMs: 300 },
);

await sleep(Number(process.env.DEMO_WEBHOOK_DELAY_MS ?? 20_000));
console.log("simulating CI success webhook");
await wakeByKey(db, "demo:pr:1", { reason: "webhook", payload: { event: "check_suite", conclusion: "success" } });
await sleep(4_000);
await worker.stop();
await db.$client.end();
console.log("demo finished");
