import { eq } from "drizzle-orm";
import { CoderOutputSchema, initialRunState, PreviousRunSchema, ReviewerOutputSchema, RunStateSchema, type LinkedIssue, type PreviousRun, type SplitOf } from "@handoff/core";
import type { PlanSize } from "@handoff/github";
import { appendEvents, nodeExecutions, projects, runs, type DbExecutor, type NewEvent } from "@handoff/db";
import { loadCompiledGraph } from "./graph-cache.ts";
import type { RunRow, WorkdirSpec } from "./types.ts";

type RunLike = Pick<RunRow, "id" | "branchName" | "state">;

/**
 * Whether a run's branch has work of its own, as its state records it: a coder that finished or
 * committed, or a pull request. Run again continues from such a branch unless a person asks otherwise.
 */
export function branchHasWork(run: Pick<RunRow, "state">): boolean {
  const state = RunStateSchema.parse(run.state);
  if (state.prNumber !== undefined) return true;
  return Object.values(state.nodes).some((r) => {
    const coder = CoderOutputSchema.safeParse(r.output).data;
    return coder !== undefined && (coder.status === "done" || coder.commitSha !== undefined);
  });
}

/**
 * What a run started again from a run's branch needs of it: the branch to start from, its plan, the
 * decisions people made in it, and the review findings it left open (each review step's latest
 * findings, and the pull request's unresolved comments).
 */
export function previousRunOf(run: RunLike): PreviousRun {
  const state = RunStateSchema.parse(run.state);
  const reviews = Object.entries(state.nodes).flatMap(([key, result]) => (ReviewerOutputSchema.safeParse(result.output).data?.comments ?? []).map((c) => ({ ...c, from: key })));
  const pr = (state.feedback?.review.comments ?? []).filter((c) => !c.resolved).map((c) => ({ path: c.path, line: c.line, body: c.body, from: c.author }));
  return PreviousRunSchema.parse({
    runId: run.id,
    branch: run.branchName,
    ...(state.plan ? { plan: { plan: state.plan.plan, steps: state.plan.steps } } : {}),
    decisions: (state as { decisions?: unknown }).decisions ?? [],
    findings: [...reviews, ...pr],
  });
}

/** Where a project's code is fetched from: its local clone when it has one, else its GitHub repository. */
export function defaultRemote(project: Pick<typeof projects.$inferSelect, "localClonePath" | "repoOwner" | "repoName">): string {
  return project.localClonePath ?? `https://github.com/${project.repoOwner}/${project.repoName}.git`;
}

/**
 * Where the worker puts a run's worktree: its branch, from the base branch, or from the branch of the
 * run it continues.
 */
export function workdirSpecOf(run: Pick<RunRow, "id" | "baseBranch" | "branchName" | "state">, remoteUrl: string): WorkdirSpec {
  const startFrom = RunStateSchema.parse(run.state).previousRun?.branch;
  return { runId: run.id, remoteUrl, baseBranch: run.baseBranch, branchName: run.branchName, ...(startFrom ? { startFrom } : {}) };
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "task";

/** Creates a queued run pinned to a graph version, with a pending execution for the start node. */
export async function createRun(
  db: DbExecutor,
  input: { projectId: string; graphVersionId: string; task: string; baseBranch?: string; branchName?: string; issues?: LinkedIssue[]; startedBy?: string | undefined; size?: PlanSize | undefined; events?: NewEvent[] | undefined; previousRun?: PreviousRun | undefined; splitOf?: SplitOf | undefined },
): Promise<RunRow> {
  const graph = await loadCompiledGraph(db, input.graphVersionId);
  const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId));
  if (!project) throw new Error(`project ${input.projectId} not found`);
  const id = crypto.randomUUID();
  return db.transaction(async (tx) => {
    const [run] = await tx
      .insert(runs)
      .values({
        id,
        projectId: project.id,
        graphVersionId: input.graphVersionId,
        status: "queued",
        task: input.task,
        state: { ...initialRunState(input.task, input.issues), ...(input.previousRun ? { previousRun: input.previousRun } : {}), ...(input.splitOf ? { splitOf: input.splitOf } : {}) },
        issues: (input.issues ?? []).map(({ number, title, url }) => ({ number, title, url })),
        baseBranch: input.baseBranch ?? project.defaultBranch,
        branchName: input.branchName ?? `handoff/${slug(input.task)}-${id.slice(0, 8)}`,
        startedBy: input.startedBy ?? null,
        size: input.size ?? null,
      })
      .returning();
    const start = graph.node(graph.startNode);
    const [execution] = await tx
      .insert(nodeExecutions)
      .values({ runId: id, nodeKey: start.key, nodeType: start.type, executorKind: graph.executorKind(start.key), attempt: 1, trigger: { kind: "start" } })
      .returning();
    await appendEvents(tx, id, [
      {
        type: "run.created",
        payload: {
          task: input.task,
          graphVersionId: input.graphVersionId,
          branchName: run!.branchName,
          issues: (input.issues ?? []).map((i) => i.number),
          ...(input.startedBy ? { startedBy: input.startedBy } : {}),
        },
      },
      ...(input.events ?? []),
      { type: "node.created", payload: { nodeKey: start.key, attempt: 1 }, nodeExecutionId: execution!.id },
    ]);
    return run!;
  });
}
