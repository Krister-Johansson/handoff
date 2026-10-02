import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { LinkedIssue } from "@handoff/core";
import { graphs, graphVersions, projects, runs, type Db, type DbExecutor, type NewEvent } from "@handoff/db";
import type { GitHubPort, PlanItem, ProjectsPort } from "@handoff/github";
import { recordPlanStatus } from "./plan-status.ts";
import { createRun } from "./runs.ts";
import type { RunRow } from "./types.ts";

type Repo = { owner: string; name: string };

export type StartRunInput = {
  projectId: string;
  graphName: string;
  task: string;
  issues?: number[] | LinkedIssue[] | undefined;
  /** A run started again passed the Ready gate the first time; its failed run leaves the task in Running. */
  again?: boolean | undefined;
  /** Who starts the run: dashboard, claude-code, assistant, webmcp, cli or scheduler. */
  startedBy?: string | undefined;
  /** The plan's items as the caller already read them: the Ready gate uses them instead of reading the Project again. */
  items?: PlanItem[] | undefined;
  /** Events the starter records on the run right after run.created, such as the scheduler's run.scheduled. */
  events?: NewEvent[] | undefined;
};

export type StartRunPorts = { github?: GitHubPort | undefined; projects?: ProjectsPort | undefined };

/**
 * Starts a run of a graph's latest version. Issues are read from GitHub so the agents get their
 * bodies; with issues and no task, the task is the issues' titles. The dashboard, the agent tools
 * and the scheduler all start runs here.
 */
export async function startRun(db: Db, input: StartRunInput, ports: StartRunPorts = {}): Promise<RunRow> {
  const { github, projects: plan } = ports;
  const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId));
  if (!project) throw new Error("project not found");
  if (project.isDemo) throw new Error("This is a demo project with simulated runs. Add a real repository to run a graph.");
  const [latest] = await db
    .select({ versionId: graphVersions.id })
    .from(graphVersions)
    .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
    .where(and(eq(graphs.projectId, input.projectId), eq(graphs.name, input.graphName)))
    .orderBy(desc(graphVersions.version))
    .limit(1);
  if (!latest) throw new Error(`no graph named ${input.graphName}`);
  const repo = { owner: project.repoOwner, name: project.repoName };
  const numbers = (input.issues ?? []).map((i) => (typeof i === "number" ? i : i.number));
  // Checked first so a taken task names its run rather than the Running status its run gave it; checked again under the lock.
  await refuseTaken(db, input.projectId, numbers);
  const issues = await linkIssues(input.issues ?? [], repo, github, plan);
  if (plan && project.planProjectNumber !== null && issues.length > 0 && !input.again) {
    refuseUnready(input.items ?? (await plan.listItems(repo.owner, project.planProjectNumber, repo)), issues);
  }
  if (github) await refuseBlocked(github, repo, issues);
  const task = input.task.trim() || issues.map((i) => `#${i.number} ${i.title}`).join("\n");
  if (!task) throw new Error("Describe the task, or link at least one issue.");
  // Starts on one project take turns, so two starts (a person's and the scheduler's) cannot both take an issue.
  const run = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`handoff.start:${input.projectId}`}))`);
    await refuseTaken(tx, input.projectId, numbers);
    return createRun(tx, { projectId: input.projectId, graphVersionId: latest.versionId, task, issues, startedBy: input.startedBy, events: input.events });
  });
  // The run owns its tasks now: they move to Running on the plan. A failed write is recorded and the run goes on.
  await recordPlanStatus(db, run.id, plan, project, issues.map((i) => i.number), "Running");
  return run;
}

/** An issue an active run links is taken: a second run on it would build the same work twice. */
async function refuseTaken(db: DbExecutor, projectId: string, issues: number[]) {
  if (issues.length === 0) return;
  const active = await db
    .select({ id: runs.id, status: runs.status, issues: runs.issues })
    .from(runs)
    .where(and(eq(runs.projectId, projectId), inArray(runs.status, ["queued", "running", "waiting"])))
    .orderBy(desc(runs.createdAt));
  for (const number of issues) {
    const taken = active.find((run) => run.issues.some((i) => i.number === number));
    if (taken) throw new Error(`#${number} is taken by run ${taken.id}, which is ${taken.status}. Wait for it to end or cancel it to start another run on #${number}.`);
  }
}

const andList = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/**
 * With a plan, Ready is the gate: a run starts only on tasks in Ready. Issues outside the plan's
 * Project are unplanned and start as before.
 */
function refuseUnready(planItems: PlanItem[], issues: LinkedIssue[]) {
  const items = new Map(planItems.map((item) => [item.number, item]));
  for (const issue of issues) {
    const item = items.get(issue.number);
    if (!item) continue;
    if (item.kind === "epic" || item.kind === "story") {
      throw new Error(`#${issue.number} is ${item.kind === "epic" ? "an epic" : "a story"} on the plan. Runs work on tasks: start a run on one of its tasks.`);
    }
    if (item.status === "Ready") continue;
    if (item.status) throw new Error(`#${issue.number} is in ${item.status} on the plan. Move it to Ready to start a run on it.`);
    throw new Error(`#${issue.number} is not Ready on the plan: its Status is not one handoff knows. Move it to Ready to start a run on it.`);
  }
}

/** A run cannot start for an issue GitHub records as blocked by an open issue: it would build on work not merged yet. */
async function refuseBlocked(github: GitHubPort, repo: Repo, issues: LinkedIssue[]) {
  const blocked = await Promise.all(issues.map(async (i) => ({ number: i.number, by: await github.openBlockers(repo, i.number) })));
  const first = blocked.find((b) => b.by.length > 0);
  if (first) throw new Error(`#${first.number} is blocked by ${andList(first.by.map((n) => `#${n}`))} on GitHub. A run can start once they are closed.`);
}

/**
 * Reads each issue with its lineage: the story and the epic it is part of, through the plan's
 * ProjectsPort, else through GitHub's sub-issues. A failed lineage read links the issue without it.
 */
async function linkIssues(issues: number[] | LinkedIssue[], repo: Repo, github?: GitHubPort, plan?: ProjectsPort): Promise<LinkedIssue[]> {
  if (issues.length === 0) return [];
  if (typeof issues[0] !== "number") return issues as LinkedIssue[];
  if (!github) throw new Error("Linking issues needs GitHub access (GITHUB_TOKEN or a GitHub App).");
  return Promise.all(
    (issues as number[]).map(async (number) => {
      const [issue, parents] = plan
        ? await Promise.all([github.getIssue(repo, number), plan.lineage(repo, number).catch(() => [])])
        : await github
            .getIssue(repo, number, { parents: true })
            .catch(() => github.getIssue(repo, number))
            .then((i) => [i, i.parents ?? []] as const);
      const lineage = parents.map((p) => ({ ...(p.kind ? { kind: p.kind } : {}), number: p.number, title: p.title, body: p.body }));
      return { number: issue.number, title: issue.title, url: issue.url, body: issue.body, ...(lineage.length ? { lineage } : {}) };
    }),
  );
}
