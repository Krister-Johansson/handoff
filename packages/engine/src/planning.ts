import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { gateMode, planBudgetOf, RunStateSchema, type CompiledGraph, type ContextPacket, type LinkedIssue, type OtherWork, type PlanOverlap } from "@handoff/core";
import { runs, type DbExecutor } from "@handoff/db";
import type { GitHubPort } from "@handoff/github";
import { overlaps } from "./backlog-scheduler/overlap.ts";
import type { ProjectRow, RunRow } from "./types.ts";

/**
 * Whether a person reviews what a planner returns before any other step uses it: a plan gate after the
 * planner, with at most reviewers between, whose changes edge leads back. Only then can the planner
 * propose a split, since a person accepts it at that gate.
 */
export function canSplit(graph: CompiledGraph, plannerKey: string): boolean {
  const next = (key: string) => graph.outEdges(key).filter((e) => !e.loop).map((e) => e.target);
  const queue = next(plannerKey);
  const seen = new Set<string>();
  while (queue.length) {
    const key = queue.shift()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const node = graph.node(key);
    // The gate sends an accepted split back through its changes edge, for the planner to plan the first part.
    if (node.type === "human_gate" && gateMode(node.config) === "approval") return graph.outEdges(key).some((e) => e.port === "changes");
    if (node.type === "reviewer") queue.push(...next(key));
  }
  return false;
}

/** A planner's size budget: the project's setting or the defaults, and whether its graph lets it split. */
export function budgetFor(project: ProjectRow, graph: CompiledGraph, plannerKey: string): NonNullable<ContextPacket["budget"]> {
  return { ...planBudgetOf(project.planBudget), canSplit: canSplit(graph, plannerKey) };
}

const ACTIVE = ["queued", "running", "waiting"] as const;

/**
 * The project's other work a planner plans around: its other active runs with the paths their plans
 * own, and the open pull requests of its other runs with the files they change, read from GitHub. A run
 * that failed keeps its pull request open, so it counts until it is cancelled or run again. Without
 * GitHub, or when GitHub does not answer, the pull requests are left out.
 */
export async function otherWorkOf(db: DbExecutor, github: GitHubPort | undefined, run: RunRow, project: ProjectRow): Promise<OtherWork> {
  const others = await db
    .select({ id: runs.id, task: runs.task, status: runs.status, branch: runs.branchName, issues: runs.issues, state: runs.state, prNumber: runs.prNumber })
    .from(runs)
    .where(and(eq(runs.projectId, run.projectId), ne(runs.id, run.id), inArray(runs.status, [...ACTIVE, "failed"]), isNull(runs.supersededBy), isNull(runs.archivedAt)))
    .orderBy(desc(runs.createdAt))
    .limit(50);
  const active = others
    .filter((o) => (ACTIVE as readonly string[]).includes(o.status))
    .map((o) => ({
      runId: o.id,
      task: o.task,
      branch: o.branch,
      issues: o.issues.map((i) => ({ number: i.number, title: i.title })),
      ownedPaths: RunStateSchema.safeParse(o.state).data?.plan?.ownedPaths ?? [],
    }));
  const repo = { owner: project.repoOwner, name: project.repoName };
  const withPr = others.filter((o) => o.prNumber !== null);
  const pulls = github
    ? (
        await Promise.all(
          withPr.map(async (o) => {
            const files = await github.listPrFiles(repo, o.prNumber!).catch(() => undefined);
            const issues = o.issues.map((i) => ({ number: i.number, title: i.title }));
            const url = `https://github.com/${repo.owner}/${repo.name}/pull/${o.prNumber}`;
            return files ? [{ runId: o.id, task: o.task, issues, number: o.prNumber!, url, branch: o.branch, files }] : [];
          }),
        )
      ).flat()
    : [];
  return { runs: active, pulls };
}

/**
 * The run's linked issues as GitHub has them now, with their comments newest first, for a planner
 * attempt. Each issue keeps the lineage the run read when it started. An issue GitHub does not answer
 * for keeps what the run had.
 */
export async function freshIssues(github: GitHubPort, project: ProjectRow, issues: LinkedIssue[]): Promise<LinkedIssue[]> {
  const repo = { owner: project.repoOwner, name: project.repoName };
  return Promise.all(
    issues.map(async (issue) => {
      try {
        const [read, comments] = await Promise.all([github.getIssue(repo, issue.number), github.listIssueComments(repo, issue.number)]);
        const newest = [...comments].reverse().map((c) => ({ author: c.author ?? "ghost", createdAt: c.createdAt, body: c.body }));
        return { ...issue, title: read.title, url: read.url, body: read.body, ...(newest.length ? { comments: newest } : {}) };
      } catch {
        return issue;
      }
    }),
  );
}

/**
 * Where a plan's owned paths meet the other work its planner was told of: what another active run's
 * plan owns, or what an open pull request changes. One entry per run, with every shared path.
 */
export function planOverlaps(ownedPaths: string[], work: OtherWork): PlanOverlap[] {
  const byRun = new Map<string, PlanOverlap>();
  const add = (runId: string, entry: Omit<PlanOverlap, "paths" | "runId">, paths: string[]) => {
    if (!paths.length) return;
    const known = byRun.get(runId) ?? { runId, ...entry, paths: [] };
    byRun.set(runId, { ...known, ...entry, ...(known.pr !== undefined ? { pr: known.pr } : {}), paths: [...new Set([...known.paths, ...paths])] });
  };
  for (const r of work.runs) add(r.runId, { task: r.task, branch: r.branch, issues: r.issues }, overlaps(ownedPaths, r.ownedPaths));
  for (const p of work.pulls) add(p.runId, { task: p.task, branch: p.branch, issues: p.issues, pr: p.number }, overlaps(ownedPaths, p.files));
  return [...byRun.values()];
}
