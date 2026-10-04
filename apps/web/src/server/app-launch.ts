import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { configurationFromForm, demoConfiguration, LAUNCH_FILE, LaunchConfigurationSchema, parseLaunchFile, type LaunchConfiguration, type LaunchForm, type LaunchFormResult } from "@handoff/core";
import { eq, projects, type Db, type LaunchTestStatus, type LaunchTestStep } from "@handoff/db";
import { DockerWorkdirProvider, dockerOptionsFromEnv, GitWorktreeProvider, launchTestOf, type LaunchTestDeps, type LaunchTestRow } from "@handoff/engine/launch-test";
import type { GitHubPort } from "@handoff/github";

type Env = Record<string, string | undefined>;

/** The repository's launch file on the default branch, as the App launch section shows it. */
export type DetectedLaunch =
  | { kind: "file"; url: string; configurations: string[]; picked: LaunchConfiguration }
  | { kind: "invalid"; url: string; error: string }
  | { kind: "none" }
  /** GitHub is not connected or did not answer, so handoff cannot tell. */
  | { kind: "unknown" };

/** A Test start as the section shows it; dates as ISO strings. */
export type LaunchTestView = {
  id: string;
  status: LaunchTestStatus;
  command: string;
  steps: LaunchTestStep[];
  port: number | null;
  url: string | null;
  error: string | null;
  /** The end of the app's log while it runs, or of the output that explains a failure. */
  log: string;
  createdAt: string;
  readyAt: string | null;
  stopsAt: string;
};

export type AppLaunchView = {
  projectId: string;
  projectName: string;
  branch: string;
  /** The worker runs steps in Docker containers, and Test start runs in containers too. */
  docker: boolean;
  detected: DetectedLaunch;
  saved: LaunchConfiguration | null;
  /** The compose file and its services on the default branch; null without one, undefined when GitHub cannot say. */
  services: { file: string; names: string[] } | null | undefined;
  seedCommand: string | null;
  test: LaunchTestView | null;
};

/** The compose file names Docker Compose looks for, in its order. */
const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];

/** Whether the worker runs steps in Docker containers: the dashboard reads the same .env. */
export const dockerWorkspace = (env: Env = process.env) => env.HANDOFF_WORKSPACE === "docker";

const savedOf = (launch: unknown): LaunchConfiguration | null => {
  const parsed = LaunchConfigurationSchema.safeParse(launch);
  return parsed.success ? parsed.data : null;
};

export function testView(test: LaunchTestRow, log: string): LaunchTestView {
  return {
    id: test.id,
    status: test.status,
    command: test.command,
    steps: test.steps,
    port: test.port,
    url: test.url,
    error: test.error,
    log,
    createdAt: test.createdAt.toISOString(),
    readyAt: test.readyAt?.toISOString() ?? null,
    stopsAt: test.stopsAt.toISOString(),
  };
}

/** The service names of a compose file; none when it cannot be read. */
function serviceNames(text: string): string[] {
  try {
    const doc = parseYaml(text) as { services?: Record<string, unknown> } | null;
    return doc?.services && typeof doc.services === "object" ? Object.keys(doc.services) : [];
  } catch {
    return [];
  }
}

/**
 * Where a Test start makes its worktree: HANDOFF_HOME's clones, as the worker's, resolved from the
 * dashboard's folder as the assistant's home is. Git authenticates as the dashboard's GitHub credential.
 * In Docker workspace mode the setup command and the app run in containers made with the worker's
 * Docker options, which mount that same HANDOFF_HOME.
 */
export function launchTestDeps(db: Db, github: GitHubPort | undefined, repo: { owner: string; name: string }, env: Env = process.env): LaunchTestDeps {
  const root = env.HANDOFF_HOME ? resolve(env.HANDOFF_HOME) : join(homedir(), ".handoff");
  const git = new GitWorktreeProvider({ root, gitEnv: async () => (github ? github.gitAuthEnv(repo).catch(() => ({})) : {}) });
  if (!dockerWorkspace(env)) return { db, workdirs: git };
  return { db, workdirs: new DockerWorkdirProvider({ git, ...dockerOptionsFromEnv({ ...env, HANDOFF_HOME: root }) }) };
}

/**
 * What Project settings, App launch shows: the launch file on the default branch when there is one (it
 * wins), else the saved setting, with what runs before the app and the latest Test start.
 */
export async function loadAppLaunch(db: Db, github: GitHubPort | undefined, projectId: string, env: Env = process.env): Promise<AppLaunchView> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error(`no project ${projectId}`);
  const repo = { owner: project.repoOwner, name: project.repoName };
  const branch = project.defaultBranch;
  const url = `https://github.com/${repo.owner}/${repo.name}/blob/${branch}/${LAUNCH_FILE}`;

  const read = (path: string) => (github ? github.getFile(repo, path, branch).then((text) => ({ text }), () => undefined) : Promise.resolve(undefined));
  const [file, composeFiles, latest] = await Promise.all([
    read(LAUNCH_FILE),
    Promise.all(COMPOSE_FILES.map(read)),
    launchTestOf(launchTestDeps(db, github, repo, env), projectId),
  ]);

  let detected: DetectedLaunch;
  if (!file) detected = { kind: "unknown" };
  else if (file.text === undefined) detected = { kind: "none" };
  else {
    try {
      const launch = parseLaunchFile(file.text);
      detected = { kind: "file", url, configurations: launch.configurations.map((c) => c.name), picked: demoConfiguration(launch) };
    } catch (error) {
      detected = { kind: "invalid", url, error: (error as Error).message };
    }
  }

  let services: AppLaunchView["services"];
  if (composeFiles.every((f) => f !== undefined)) {
    const index = composeFiles.findIndex((f) => f!.text !== undefined);
    services = index === -1 ? null : { file: COMPOSE_FILES[index]!, names: serviceNames(composeFiles[index]!.text!) };
  }

  return {
    projectId: project.id,
    projectName: project.name,
    branch,
    docker: dockerWorkspace(env),
    detected,
    saved: savedOf(project.launch),
    services,
    seedCommand: project.demoSeedCommand,
    test: latest ? testView(latest.test, latest.log) : null,
  };
}

/** Saves the App launch form as the project's setting, or says what to fix and saves nothing. */
export async function saveAppLaunch(db: Db, projectId: string, form: LaunchForm): Promise<LaunchFormResult> {
  const result = configurationFromForm(form);
  if (!result.ok) return result;
  const [row] = await db.update(projects).set({ launch: result.configuration, updatedAt: new Date() }).where(eq(projects.id, projectId)).returning({ id: projects.id });
  if (!row) throw new Error("The project no longer exists.");
  return result;
}
