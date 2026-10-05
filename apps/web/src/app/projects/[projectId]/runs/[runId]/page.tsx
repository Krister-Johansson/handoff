import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ClockIcon, CoinsIcon, GitBranchIcon, GitForkIcon, GitPullRequestIcon, TimerIcon } from "lucide-react";
import { describePermission, GraphDocumentSchema, RunStateSchema, summarizeOutput } from "@handoff/core";
import { permissionWaits } from "@handoff/db";
import { branchHasWork } from "@handoff/engine/runs";
import { RunLineage } from "@/components/runs/run-lineage";
import { Button } from "@/components/ui/button";
import { CancelRunButton, FailedRunCard, QuestionCard } from "@/components/inbox/cards";
import { PermissionCard, type PermissionRequestView } from "@/components/runs/permission-card";
import { pendingPermissions } from "@/server/permissions";
import { IssueLinks, PartOf } from "@/components/runs/issue-links";
import { RunAgainButton } from "@/components/runs/run-again-button";
import { RunLive, type OpenQuestion } from "@/components/runs/run-live";
import { projectCrumb, projectRunsCrumb, runCrumb } from "@/server/crumbs";
import { StuckLoopCard } from "@/components/runs/stuck-loop-card";
import { stuckLoop, type StuckLoop } from "@handoff/engine/operations";
import { getDb } from "@/lib/db";
import type { RunQueue } from "@/lib/run-now";
import { projectMergeQueue } from "@/server/merge-queue";
import { graphPath, runPath } from "@/lib/paths";
import { formatCost, formatDuration } from "@/lib/format";
import { getRunDetail } from "@/server/queries";
import { StartedByScheduler } from "@/components/scheduler/scheduler-tag";
import { OpenInEditor } from "@/components/runs/open-in-editor";
import type { WorktreeState } from "@/lib/worktree-state";
import { workerHome, worktreeState } from "@/server/worktree";
import { RunTaskBody } from "@/components/runs/run-task";
import { taskParts } from "@/lib/run-task";

export const dynamic = "force-dynamic";

/** Node labels by key from the run's pinned graph document. */
function nodeLabels(document: unknown): Record<string, string> {
  const parsed = GraphDocumentSchema.safeParse(document);
  if (!parsed.success) return {};
  return Object.fromEntries(parsed.data.nodes.map((n) => [n.key, n.attributes.label ?? n.key]));
}

type Detail = NonNullable<Awaited<ReturnType<typeof getRunDetail>>>;

/** The run's open questions as the cards and the drawer show them. */
function questionItems({ run, project, openQuestions }: Detail): OpenQuestion[] {
  return openQuestions.map((q) => ({
    ...q,
    runId: run.id,
    projectId: project.id,
    task: run.task,
    projectName: project.name,
    reason: typeof q.context.reason === "string" ? q.context.reason : "approval",
  }));
}

/**
 * What the run needs from a person: questions to answer here, a decision for a loop that ran out, or a
 * repair. A review waiting on a person is opened from the status banner instead.
 */
function RunAlerts({ detail, stuck, permissions }: { detail: Detail; stuck: StuckLoop | undefined; permissions: PermissionRequestView[] }) {
  const { run, project, graph, failed } = detail;
  return (
    <>
      {permissions.map((p) => (
        <PermissionCard key={p.id} request={p} />
      ))}
      {questionItems(detail)
        .filter((q) => !q.context?.review)
        .map((q) => (
          <QuestionCard key={q.id} compact item={q} />
        ))}
      {stuck && <StuckLoopCard runId={run.id} node={nodeLabels(graph?.document)[stuck.nodeKey] ?? stuck.nodeKey} loop={stuck.edgeKey} attempts={stuck.attempts} />}
      {run.status === "failed" && failed && !stuck && (
        <FailedRunCard
          compact
          item={{
            runId: run.id,
            projectId: project.id,
            task: run.task,
            projectName: project.name,
            executionId: failed.id,
            nodeKey: failed.nodeKey,
            attempt: failed.attempt,
            error: failed.error ?? null,
            latestGraphVersion: graph && graph.latestVersion > graph.version ? graph.latestVersion : null,
          }}
        />
      )}
    </>
  );
}

/** The issues GitHub said block the run, while the step that found them (its start or its merge) still waits. */
function blockersOf({ run, executions, events }: Detail): number[] | undefined {
  if (run.status !== "waiting") return undefined;
  const waiting = new Set(executions.filter((e) => e.status === "waiting").map((e) => e.id));
  const blockers = events
    .filter((e) => (e.type === "run.blocked" || e.type === "merge.blocked") && e.nodeExecutionId !== null && waiting.has(e.nodeExecutionId))
    .flatMap((e) => (e.payload as { blockedBy?: number[] }).blockedBy ?? []);
  return blockers.length ? [...new Set(blockers)] : undefined;
}

/** The run's place in the scheduler's order, when the scheduler started it. */
function scheduledPlace(events: Detail["events"]): number | undefined {
  const place = (events.find((e) => e.type === "run.scheduled")?.payload as { place?: unknown } | undefined)?.place;
  return typeof place === "number" ? place : undefined;
}

/** Where the run stands in its project's merge queue, while its merge step waits there. */
async function queuePlace(projectId: string, runId: string): Promise<RunQueue | undefined> {
  const entry = (await projectMergeQueue(getDb(), projectId)).find((e) => e.runId === runId && e.waiting);
  return entry && { position: entry.position, requested: entry.requested, mode: entry.mode };
}

/**
 * Open in VS Code, the run's pull request, and Cancel while it is active or Run again once it ended. A run
 * another run superseded links to that run instead of offering Run again.
 */
function RunActions({ run, project, active, worktree }: { run: Detail["run"]; project: Detail["project"]; active: boolean; worktree: WorktreeState }) {
  return (
    <>
      <OpenInEditor worktree={worktree} />
      {run.prNumber !== null ? (
        <Button size="sm" variant="outline" asChild>
          <a href={`https://github.com/${project.repoOwner}/${project.repoName}/pull/${run.prNumber}`}>
            <GitPullRequestIcon data-icon="inline-start" />
            PR #{run.prNumber}
          </a>
        </Button>
      ) : (
        active && (
          <Button size="sm" variant="outline" disabled>
            <GitPullRequestIcon data-icon="inline-start" />
            No PR yet
          </Button>
        )
      )}
      {active ? (
        <CancelRunButton runId={run.id} />
      ) : (
        !project.isDemo && !run.supersededBy && <RunAgainButton runId={run.id} branch={run.branchName} hasWork={branchHasWork(run)} />
      )}
    </>
  );
}

export default async function RunPage({ params }: { params: Promise<{ projectId: string; runId: string }> }) {
  const { projectId, runId } = await params;
  const detail = await getRunDetail(getDb(), runId);
  if (!detail) notFound();
  // A run linked under another project still opens, at its own project's address.
  if (detail.project.id !== projectId) redirect(runPath(detail.project.id, runId));
  const { run, project, executions, events, graph } = detail;
  const stuck = run.status === "failed" ? await stuckLoop(getDb(), run.id) : undefined;
  const active = run.status === "queued" || run.status === "running" || run.status === "waiting";
  const [queue, permissions, waits] = active
    ? await Promise.all([queuePlace(project.id, run.id), pendingPermissions(getDb(), run.id), permissionWaits(getDb(), [run.id])])
    : [undefined, [], undefined];
  const wait = waits?.get(run.id);
  const blockedBy = blockersOf(detail);
  const totalCost = executions.reduce((sum, e) => sum + Number(e.costUsd ?? 0), 0);
  const worktree = worktreeState(run, workerHome());
  const task = taskParts(run.task);
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <RunLive
        header={{
          crumbs: [projectCrumb(project), projectRunsCrumb(project.id), await runCrumb(getDb(), project.id, run)],
          title: task.title,
          meta: (
            <>
              {task.body && <RunTaskBody body={task.body} />}
              <div className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs [&_svg]:size-[13px] [&_svg]:shrink-0">
                {/* A task made from the issues' titles already names them; then only the numbers are linked. */}
                <IssueLinks variant="meta" projectId={project.id} issues={run.issues} showTitles={!run.issues.every((i) => run.task.includes(`#${i.number} ${i.title}`))} />
                <PartOf issues={run.issues} projectId={project.id} />
                <StartedByScheduler startedBy={run.startedBy} place={scheduledPlace(events)} />
                <RunLineage projectId={project.id} continues={RunStateSchema.shape.previousRun.parse(run.state.previousRun)?.runId ?? null} supersededBy={run.supersededBy} />
                {graph && (
                  <Link href={graphPath(project.id, graph.name, graph.version)} className="inline-flex items-center gap-[5px] hover:text-foreground hover:underline hover:underline-offset-3">
                    <GitForkIcon aria-hidden />
                    <span>
                      <span className="font-mono">{graph.name}</span> v{graph.version}
                    </span>
                  </Link>
                )}
                <span className="inline-flex items-center gap-[5px]" title={run.createdAt.toISOString()}>
                  <ClockIcon aria-hidden />
                  started {run.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                </span>
                {run.startedAt && run.finishedAt && (
                  <span className="inline-flex items-center gap-[5px]">
                    <TimerIcon aria-hidden />
                    took {formatDuration(run.finishedAt.getTime() - run.startedAt.getTime())}
                  </span>
                )}
                {totalCost > 0 && (
                  <span className="inline-flex items-center gap-[5px]" title="Client-side estimate reported by the Claude CLI">
                    <CoinsIcon aria-hidden />
                    {formatCost(totalCost)} est.
                  </span>
                )}
                <a
                  className="inline-flex min-w-0 items-center gap-[5px] font-mono hover:text-foreground hover:underline hover:underline-offset-3"
                  href={`https://github.com/${project.repoOwner}/${project.repoName}/tree/${run.branchName}`}
                >
                  <GitBranchIcon aria-hidden />
                  <span className="truncate">{run.branchName}</span>
                </a>
              </div>
            </>
          ),
          actions: <RunActions run={run} project={project} active={active} worktree={worktree} />,
        }}
        awaitsWorktree={active && worktree.state !== "open"}
        runId={run.id}
        projectId={project.id}
        initialStatus={run.status}
        initialExecutions={executions.map((e) => ({
          id: e.id,
          nodeKey: e.nodeKey,
          attempt: e.attempt,
          status: e.status,
          costUsd: e.costUsd,
          durationMs: e.startedAt && e.finishedAt ? e.finishedAt.getTime() - e.startedAt.getTime() : null,
          summary: summarizeOutput(e.output),
          via: e.trigger?.kind === "edge" ? (e.trigger.edgeKey ?? null) : null,
          ...(e.status === "failed" && e.error ? { error: `${e.error.code}: ${e.error.message}` } : {}),
        }))}
        labels={nodeLabels(graph?.document)}
        prNumber={run.prNumber}
        questions={questionItems(detail)}
        queue={queue}
        blockedBy={blockedBy}
        initialEvents={events}
        graphDocument={graph?.document}
        waitingOn={wait && { kind: wait.kind, nodeKey: wait.nodeKey, since: wait.since, action: describePermission(wait.toolName, wait.input).action }}
      >
        <RunAlerts detail={detail} stuck={stuck} permissions={permissions} />
      </RunLive>
    </main>
  );
}
