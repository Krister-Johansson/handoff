import { mkdirSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { buildClaudeArgv, ClaudeCliExecutor } from "@handoff/cli-adapter";
import { createDb } from "@handoff/db";
import { runMigrations } from "@handoff/db/migrate";
import { startBacklogScheduler } from "@handoff/engine/backlog-scheduler";
import { branchDiff, cliNodeExecutor, demoExecutor, finishExecutor, startExecutor, DockerWorkdirProvider, GitWorktreeProvider, humanGateExecutor, mergeNodeExecutor, prNodeExecutor, startWorker, testerExecutor, type EngineDeps } from "@handoff/engine";
import { OctokitGitHub, projectsFromEnv, type GitHubPort, type ProjectsPort } from "@handoff/github";
import { checkClaudeVersion } from "./claude-version.ts";
import type { WorkerEnv } from "./env.ts";
import { planAccess } from "./plan-status.ts";
import { parseGitHubRemote } from "./remote.ts";
import { startSchedulerWith } from "./scheduler-access.ts";

export function createGitHub(env: WorkerEnv): GitHubPort {
  return env.github.mode === "app"
    ? OctokitGitHub.withApp({ appId: env.github.appId, privateKey: readFileSync(env.github.privateKeyPath, "utf8") })
    : OctokitGitHub.withToken(env.github.token);
}

/**
 * Wires the engine from environment: Claude CLI, GitHub, git worktrees and the node executors. With
 * `projects`, the PR and merge nodes move the run's tasks on the plan.
 */
export function buildEngine(env: WorkerEnv, log: (message: string, detail?: unknown) => void, projects?: ProjectsPort): EngineDeps {
  const home = resolve(env.HANDOFF_HOME);
  const configDir = join(home, "claude-config");
  mkdirSync(configDir, { recursive: true });
  const github = createGitHub(env);
  const cli = new ClaudeCliExecutor({
    // Inside the runner image the CLI is on PATH as `claude`.
    command: { file: env.HANDOFF_WORKSPACE === "docker" ? env.HANDOFF_CONTAINER_CLAUDE_BIN : env.HANDOFF_CLAUDE_BIN, prefixArgs: [] },
    oauthToken: env.CLAUDE_CODE_OAUTH_TOKEN,
    configDir,
    ...(env.HANDOFF_CLAUDE_PASSTHROUGH_ENV ? { passthroughEnv: env.HANDOFF_CLAUDE_PASSTHROUGH_ENV.split(",").map((k) => k.trim()) } : {}),
  });
  const db = createDb(env.DATABASE_URL);
  const cliOptions = {
    cli,
    maxTurns: env.HANDOFF_MAX_TURNS,
    timeoutMs: env.HANDOFF_CLI_TIMEOUT_MS,
    idleTimeoutMs: 10 * 60_000,
    ...(env.HANDOFF_MODEL ? { model: env.HANDOFF_MODEL } : {}),
    ...(env.HANDOFF_EFFORT ? { effort: env.HANDOFF_EFFORT } : {}),
    // A tool call outside a step's allow rules waits for a person on the run page instead of being denied.
    permissions: { db, caps: env.caps },
  };
  const agent = cliNodeExecutor(cliOptions);
  const git = new GitWorktreeProvider({
    root: home,
    gitEnv: async (remote) => {
      const repo = parseGitHubRemote(remote);
      return repo ? github.gitAuthEnv(repo) : {};
    },
  });
  const workerId = env.HANDOFF_WORKER_ID ?? `${hostname()}:${process.pid}`;
  return {
    db,
    workerId,
    caps: env.caps,
    leaseMs: 60_000,
    stagingRoot: join(home, "staging"),
    executors: {
      planner: agent,
      coder: agent,
      reviewer: agent,
      code_review: agent,
      start: startExecutor({ github }),
      finish: finishExecutor(),
      tester: testerExecutor(),
      demo: demoExecutor({ ...cliOptions, db, workerId, artifactsRoot: join(home, "artifacts") }),
      human_gate: humanGateExecutor({ db, branchDiff, workerId }),
      pr: prNodeExecutor({ github, db, reconcileMs: env.HANDOFF_PR_RECONCILE_MS, projects }),
      merge: mergeNodeExecutor({ github, db, projects }),
    },
    workdirs: env.HANDOFF_WORKSPACE === "docker" ? new DockerWorkdirProvider({ git, image: env.HANDOFF_DOCKER_IMAGE, mounts: [home, ...(env.HANDOFF_DOCKER_MOUNTS?.split(",").map((m) => m.trim()).filter(Boolean) ?? [])], ...(env.HANDOFF_DOCKER_NETWORK ? { network: env.HANDOFF_DOCKER_NETWORK } : {}) }) : git,
    log,
  };
}

export async function runWorker(env: WorkerEnv) {
  const log = (message: string, detail?: unknown) => console.log(`[worker] ${message}`, detail ?? "");
  const docker = env.HANDOFF_WORKSPACE === "docker";
  const mounts = env.HANDOFF_DOCKER_MOUNTS?.split(",").map((m) => m.trim()).filter(Boolean) ?? [];
  const cli = await checkClaudeVersion(
    docker ? env.HANDOFF_CONTAINER_CLAUDE_BIN : env.HANDOFF_CLAUDE_BIN,
    env.HANDOFF_CLAUDE_VERSION,
    env.allowCliDrift,
    docker ? { image: env.HANDOFF_DOCKER_IMAGE, mounts } : undefined,
  );
  if (docker) log(`running nodes in containers from ${env.HANDOFF_DOCKER_IMAGE}`);
  if (cli.drift) log(`claude ${cli.version} differs from the pinned ${env.HANDOFF_CLAUDE_VERSION}; continuing because HANDOFF_ALLOW_CLI_DRIFT is set`);
  // A GitHub App cannot reach a user-owned Project: status writes need GITHUB_TOKEN even when the App runs the rest.
  const projects = await planAccess(projectsFromEnv({ GITHUB_TOKEN: env.GITHUB_TOKEN }), log);
  const deps = buildEngine(env, log, projects);
  await runMigrations(deps.db);
  const template = buildClaudeArgv({
    prompt: "<prompt>",
    jsonSchema: {},
    allowedTools: ["<tools>"],
    maxTurns: env.HANDOFF_MAX_TURNS,
    systemPromptFile: "<context.md>",
    addDirs: [],
    session: { mode: "new", id: "<execution-id>", name: "<name>" },
    claudeMdExcludes: ["<instruction files in the workdir's ancestors>"],
  });
  log(`claude ${cli.version}; argv template: claude ${template.map((a) => (a.includes(" ") ? JSON.stringify(a) : a)).join(" ")}`);
  log(`worker ${deps.workerId} started; caps ${JSON.stringify(env.caps)}`);
  const handle = startWorker(deps, { pollIntervalMs: 1000, maxInFlight: 4 });
  // The scheduler starts runs on Ready tasks of projects that turned it on; it reads them from the plan.
  const scheduler = startSchedulerWith(projects, (plan) => startBacklogScheduler({ db: deps.db, github: createGitHub(env), projects: plan, owner: deps.workerId, log }, { pollMs: 5000 }), log);
  const shutdown = async (signal: string) => {
    log(`${signal} received; stopping (running nodes are released for reclaim)`);
    await scheduler?.stop();
    await handle.stop();
    await deps.db.$client.end();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}
