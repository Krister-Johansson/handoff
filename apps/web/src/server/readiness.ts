import { criteriaInIssue, LAUNCH_FILE, parseLaunchFile } from "@handoff/core";
import { and, desc, eq, graphs, gt, liveWorkers, projects, sql, webhookDeliveries, type Db } from "@handoff/db";
import type { GitHubPort } from "@handoff/github";

/** ok: in place. todo: missing, with how to fix it. info: worth knowing, not needed. */
export type CheckStatus = "ok" | "todo" | "info";
export type ReadinessCheck = { id: string; title: string; required: boolean; status: CheckStatus; detail: string; fix?: string };

const WORKER_WINDOW_MS = 60_000;
const ISSUES_SAMPLED = 10;

const check = (c: ReadinessCheck) => c;

/** The launch file's state on the default branch: whether handoff can start the app for Demo and Try it. */
function launchCheck(text: string | undefined): ReadinessCheck {
  const base = { id: "launch", title: "The app starts from .claude/launch.json", required: false };
  const fix =
    `Add ${LAUNCH_FILE} with one configuration (name, runtimeExecutable, runtimeArgs, port) and make the dev server listen on the PORT environment variable, ` +
    "since handoff gives each run's app a free port. Put local, non-secret environment values such as a local database URL in its env. " +
    "Without it, Demo and Try it steps cannot start the app.";
  if (text === undefined) return check({ ...base, status: "todo", detail: `No ${LAUNCH_FILE} on the default branch.`, fix });
  try {
    const launch = parseLaunchFile(text);
    const first = launch.configurations[0]!;
    const portNote = first.autoPort === false ? ` It must have port ${first.port} (autoPort is false), so two runs cannot preview at once.` : " The app gets a free port in PORT.";
    return check({ ...base, status: "ok", detail: `Starts configuration ${first.name} with ${first.runtimeExecutable ?? `node ${first.program}`}.${portNote}` });
  } catch (error) {
    return check({ ...base, status: "todo", detail: (error as Error).message, fix });
  }
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

/**
 * Whether a project is set up to work well with handoff, item by item, with how to fix what is missing.
 * The graph and a running worker are required; the rest makes runs better (an app the Demo and Try it
 * steps can start, CI the PR node waits for, criteria to check against, dependencies that order runs).
 */
export async function projectReadiness(db: Db, github: GitHubPort | undefined, projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error(`no project ${projectId}`);
  const repo = { owner: project.repoOwner, name: project.repoName };
  const dayAgo = sql`now() - interval '1 day'`;
  const [graphRows, workers, delivery, claudeMd, launch, ci, issues] = await Promise.all([
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
  ]);

  const checks: ReadinessCheck[] = [
    graphRows.length
      ? check({ id: "graph", title: "A graph to run", required: true, status: "ok", detail: `Graphs: ${graphRows.map((g) => g.name).join(", ")}.` })
      : check({
          id: "graph",
          title: "A graph to run",
          required: true,
          status: "todo",
          detail: "The project has no graph.",
          fix: "Create one on the project's Settings tab in the dashboard, or import one with `pnpm handoff graph import --project <name> --name <graph> <file.json>`.",
        }),
    workers.length
      ? check({ id: "worker", title: "A worker is running", required: true, status: "ok", detail: `${workers.length} worker${workers.length === 1 ? "" : "s"} online.` })
      : check({ id: "worker", title: "A worker is running", required: true, status: "todo", detail: "No worker has checked in in the last minute.", fix: "Start one with `pnpm dev:worker` in the handoff checkout." }),
    project.setupCommand
      ? check({ id: "setup_command", title: "A setup command", required: false, status: "ok", detail: `Each run's worktree runs \`${project.setupCommand}\` first.` })
      : check({
          id: "setup_command",
          title: "A setup command",
          required: false,
          status: "todo",
          detail: "Runs start in a fresh worktree with no dependencies installed.",
          fix: "Set the project's setup command on its Settings tab, such as `pnpm install`, so tests, Demo and Try it have dependencies.",
        }),
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
    launchCheck(launch),
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
  ];
  return { project: { id: project.id, name: project.name, repo: `${project.repoOwner}/${project.repoName}` }, ready: checks.every((c) => !c.required || c.status === "ok"), checks };
}
