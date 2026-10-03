import { commandLine, criteriaInIssue, demoConfiguration, LAUNCH_FILE, LaunchConfigurationSchema, parseLaunchFile } from "@handoff/core";
import { and, desc, eq, graphs, gt, liveWorkers, projects, sql, webhookDeliveries, type Db } from "@handoff/db";
import type { GitHubPort, ProjectsPort } from "@handoff/github";
import { projectsAccessProblem, SCOPE_FIX } from "./plan";

/** ok: in place. todo: missing, with how to fix it. info: worth knowing, not needed. */
export type CheckStatus = "ok" | "todo" | "info";
export type ReadinessCheck = { id: string; title: string; required: boolean; status: CheckStatus; detail: string; fix?: string };

const WORKER_WINDOW_MS = 60_000;
const ISSUES_SAMPLED = 10;

const check = (c: ReadinessCheck) => c;

/**
 * Whether handoff can start the app for Demo and Try it: the launch file on the default branch, else the
 * project's App launch setting.
 */
function launchCheck(text: string | undefined, setting: unknown): ReadinessCheck {
  const base = { id: "launch", title: "The app starts", required: false };
  const fix =
    `Set the command in Project settings, App launch, or add ${LAUNCH_FILE} with one configuration (name, runtimeExecutable, runtimeArgs, port). ` +
    "Make the dev server listen on the PORT environment variable, since handoff gives each run's app a free port. Put local, non-secret environment values such as a local database URL in its env. " +
    "Without either, Demo and Try it steps cannot start the app.";
  if (text === undefined) {
    const saved = LaunchConfigurationSchema.safeParse(setting);
    if (setting && saved.success) return check({ ...base, status: "ok", detail: `No ${LAUNCH_FILE}; the project's App launch setting starts \`${commandLine(saved.data)}\`.` });
    return check({ ...base, status: "todo", detail: `No ${LAUNCH_FILE} on the default branch and no App launch setting.`, fix });
  }
  try {
    const launch = parseLaunchFile(text);
    const first = demoConfiguration(launch);
    const portNote = first.autoPort === false ? ` It must have port ${first.port} (autoPort is false), so two runs cannot preview at once.` : " The app gets a free port in PORT.";
    return check({ ...base, status: "ok", detail: `Starts configuration ${first.name} with ${first.runtimeExecutable ?? `node ${first.program}`}.${portNote}` });
  } catch (error) {
    return check({ ...base, status: "todo", detail: (error as Error).message, fix });
  }
}

/** Each package manager's lockfile, with the setup command that installs exactly what it pins. */
const LOCKFILE_INSTALLS: [file: string, command: string][] = [
  ["pnpm-lock.yaml", "pnpm install --frozen-lockfile"],
  ["package-lock.json", "npm ci"],
  ["yarn.lock", "yarn install --frozen-lockfile"],
  ["bun.lock", "bun install --frozen-lockfile"],
  ["bun.lockb", "bun install --frozen-lockfile"],
];

/** The first lockfile on the default branch, and the install command it suggests. */
async function lockfileOf(github: GitHubPort, repo: { owner: string; name: string }, branch: string) {
  const found = await Promise.all(LOCKFILE_INSTALLS.map(([file]) => github.getFile(repo, file, branch).catch(() => undefined)));
  const index = found.findIndex((text) => text !== undefined);
  return index === -1 ? undefined : { file: LOCKFILE_INSTALLS[index]![0], install: LOCKFILE_INSTALLS[index]![1] };
}

/** Whether each run's worktree is set up; a repository with a lockfile and no setup command gets the install command to use. */
function setupCheck(setupCommand: string | null, lockfile: { file: string; install: string } | undefined): ReadinessCheck {
  const base = { id: "setup_command", title: "A setup command", required: false };
  if (setupCommand) return check({ ...base, status: "ok", detail: `Each run's worktree runs \`${setupCommand}\` first.` });
  const perRun =
    " If the tests need their own database, create it there too, for example by copying .env.example to .env with the test database named after HANDOFF_RUN_SHORT, and drop it in the teardown command.";
  if (lockfile) {
    return check({
      ...base,
      status: "todo",
      detail: `The repository has ${lockfile.file}, but runs start in a fresh worktree with no dependencies installed.`,
      fix: `Set the project's setup command in Settings, Projects to \`${lockfile.install}\`, so tests, Demo and Try it have dependencies.${perRun}`,
    });
  }
  return check({
    ...base,
    status: "todo",
    detail: "Runs start in a fresh worktree with no dependencies installed.",
    fix: `Set the project's setup command in Settings, Projects, such as \`pnpm install\`, so tests, Demo and Try it have dependencies.${perRun}`,
  });
}

/** How many of the recent open issues list acceptance criteria as checkboxes. */
async function acceptanceCheck(github: GitHubPort, repo: { owner: string; name: string }, numbers: number[]): Promise<ReadinessCheck> {
  const base = { id: "acceptance", title: "Issues list acceptance criteria", required: false };
  const fix =
    "Write each issue's acceptance criteria as checkboxes under a heading such as \"## Acceptance criteria\" (\"- [ ] A user can create a task\"). " +
    "Demo screenshots and the Try it checklist use them; without them the planner writes its own.";
  if (numbers.length === 0) return check({ ...base, status: "info", detail: "No open issues to look at." });
  const bodies = await Promise.all(numbers.slice(0, ISSUES_SAMPLED).map((n) => github.getIssue(repo, n).then((i) => i.body).catch(() => "")));
  const withCriteria = bodies.filter((body) => criteriaInIssue(body).length > 0).length;
  const detail = `${withCriteria} of ${bodies.length} recent open issues list acceptance criteria.`;
  return withCriteria > 0 ? check({ ...base, status: "ok", detail }) : check({ ...base, status: "todo", detail, fix });
}

/** Whether the project has a plan on GitHub Projects that handoff can reach. Never required. */
async function planCheck(plan: ProjectsPort | undefined, project: { repoOwner: string; planProjectNumber: number | null }): Promise<ReadinessCheck> {
  const base = { id: "plan", title: "A plan on GitHub Projects", required: false };
  const number = project.planProjectNumber;
  if (number === null) {
    return check({
      ...base,
      status: "info",
      detail: "The project has no plan on GitHub Projects.",
      fix: "Set up a plan to shape epics, stories and tasks: ask the assistant, or call setup_plan. Only tasks in Ready then reach the backlog.",
    });
  }
  const problem = await projectsAccessProblem(plan).catch((error: unknown) => `GitHub refused the token: ${(error as Error).message}`);
  if (problem || !plan) return check({ ...base, status: "todo", detail: problem ?? "GITHUB_TOKEN is not set.", fix: SCOPE_FIX });
  const found = await plan.getProject(project.repoOwner, number).catch(() => undefined);
  if (!found) {
    return check({
      ...base,
      status: "todo",
      detail: `GitHub Project #${number} of ${project.repoOwner} does not exist or GITHUB_TOKEN cannot see it.`,
      fix: `Check the Project on GitHub, or run setup_plan to set up the plan again. ${SCOPE_FIX}`,
    });
  }
  return check({ ...base, status: "ok", detail: `The plan is GitHub Project #${number}, ${found.title}: ${found.url}` });
}

/**
 * Whether a project is set up to work well with handoff, item by item, with how to fix what is missing.
 * The graph and a running worker are required; the rest makes runs better (an app the Demo and Try it
 * steps can start, CI the PR node waits for, criteria to check against, dependencies that order runs).
 */
export async function projectReadiness(db: Db, github: GitHubPort | undefined, projectId: string, plan?: ProjectsPort) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error(`no project ${projectId}`);
  const repo = { owner: project.repoOwner, name: project.repoName };
  const dayAgo = sql`now() - interval '1 day'`;
  const [graphRows, workers, delivery, claudeMd, launch, ci, issues, planned] = await Promise.all([
    db.select({ name: graphs.name }).from(graphs).where(eq(graphs.projectId, project.id)),
    liveWorkers(db, WORKER_WINDOW_MS),
    project.repoId === null
      ? Promise.resolve([])
      : db
          .select({ at: webhookDeliveries.receivedAt })
          .from(webhookDeliveries)
          .where(and(eq(webhookDeliveries.repoId, project.repoId), gt(webhookDeliveries.receivedAt, dayAgo)))
          .orderBy(desc(webhookDeliveries.receivedAt))
          .limit(1),
    github?.getFile(repo, "CLAUDE.md", project.defaultBranch).catch(() => undefined),
    github?.getFile(repo, LAUNCH_FILE, project.defaultBranch).catch(() => undefined),
    github?.expectsChecks(repo, project.defaultBranch).catch(() => false),
    github?.listIssues(repo).catch(() => []) ?? Promise.resolve([]),
    planCheck(plan, project),
  ]);
  const lockfile = project.setupCommand || !github ? undefined : await lockfileOf(github, repo, project.defaultBranch);

  const checks: ReadinessCheck[] = [
    graphRows.length
      ? check({ id: "graph", title: "A graph to run", required: true, status: "ok", detail: `Graphs: ${graphRows.map((g) => g.name).join(", ")}.` })
      : check({
          id: "graph",
          title: "A graph to run",
          required: true,
          status: "todo",
          detail: "The project has no graph.",
          fix: "Create one on the project's Graphs page in the dashboard, or import one with `pnpm handoff graph import --project <name> --name <graph> <file.json>`.",
        }),
    workers.length
      ? check({ id: "worker", title: "A worker is running", required: true, status: "ok", detail: `${workers.length} worker${workers.length === 1 ? "" : "s"} online.` })
      : check({ id: "worker", title: "A worker is running", required: true, status: "todo", detail: "No worker has checked in in the last minute.", fix: "Start one with `pnpm dev:worker` in the handoff checkout." }),
    setupCheck(project.setupCommand, lockfile),
    claudeMd !== undefined
      ? check({ id: "claude_md", title: "CLAUDE.md for the agents", required: false, status: "ok", detail: "The agents read the repository's CLAUDE.md." })
      : check({
          id: "claude_md",
          title: "CLAUDE.md for the agents",
          required: false,
          status: "todo",
          detail: "No CLAUDE.md on the default branch.",
          fix: "Add a CLAUDE.md with the commands to install, test, lint and run the app, the code layout and the conventions to follow. Every agent step reads it.",
        }),
    launchCheck(launch, project.launch),
    ci
      ? check({ id: "ci", title: "CI on pull requests", required: false, status: "ok", detail: "The PR node waits for the repository's checks." })
      : check({
          id: "ci",
          title: "CI on pull requests",
          required: false,
          status: "todo",
          detail: "No workflow or required check, so the PR node goes on without CI.",
          fix: "Add a GitHub Actions workflow that runs lint, typecheck and tests on pull requests, so a run cannot merge red.",
        }),
    await (github ? acceptanceCheck(github, repo, issues.map((i) => i.number)) : Promise.resolve(check({ id: "acceptance", title: "Issues list acceptance criteria", required: false, status: "info", detail: "GitHub is not connected." }))),
    issues.some((i) => i.blockedBy.length > 0)
      ? check({ id: "dependencies", title: "Issue dependencies", required: false, status: "ok", detail: `${issues.filter((i) => i.blockedBy.length > 0).length} open issues wait on others.` })
      : check({
          id: "dependencies",
          title: "Issue dependencies",
          required: false,
          status: "info",
          detail: "No open issue is blocked by another.",
          fix: 'When issues build on each other, add "Depends on: #n" lines and use Link dependencies on the Issues tab, so runs start and merge in order.',
        }),
    delivery.length
      ? check({ id: "webhooks", title: "GitHub webhooks reach handoff", required: false, status: "ok", detail: "A webhook arrived in the last day." })
      : check({
          id: "webhooks",
          title: "GitHub webhooks reach handoff",
          required: false,
          status: "info",
          detail: "No webhook from this repository in the last day.",
          fix: `Run \`pnpm dev:webhooks ${project.repoOwner}/${project.repoName}\` while runs are active, or install the GitHub App, so CI results wake runs at once instead of on the next check.`,
        }),
    planned,
  ];
  return { project: { id: project.id, name: project.name, repo: `${project.repoOwner}/${project.repoName}` }, ready: checks.every((c) => !c.required || c.status === "ok"), checks };
}
