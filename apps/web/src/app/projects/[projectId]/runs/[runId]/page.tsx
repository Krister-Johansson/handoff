import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ClockIcon, CoinsIcon, GitBranchIcon, GitForkIcon, GitPullRequestIcon, TimerIcon } from "lucide-react";
import { GraphDocumentSchema, summarizeOutput } from "@handoff/core";
import { Button } from "@/components/ui/button";
import { CancelRunButton, FailedRunCard, QuestionCard } from "@/components/inbox/cards";
import { IssueLinks } from "@/components/runs/issue-links";
import { RunAgainButton } from "@/components/runs/run-again-button";
import { PageHeader } from "@/components/page-header";
import { RunLive, type OpenQuestion } from "@/components/runs/run-live";
import { projectCrumbs, projectRunsCrumb, runCrumb } from "@/server/crumbs";
import { StuckLoopCard } from "@/components/runs/stuck-loop-card";
import { stuckLoop, type StuckLoop } from "@handoff/engine/operations";
import { getDb } from "@/lib/db";
import { runPath } from "@/lib/paths";
import { formatCost, formatDuration } from "@/lib/format";
import { getRunDetail } from "@/server/queries";

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
function RunAlerts({ detail, stuck }: { detail: Detail; stuck: StuckLoop | undefined }) {
  const { run, project, graph, failed } = detail;
  return (
    <>
      {questionItems(detail)
        .filter((q) => !q.context?.review)
        .map((q) => (
          <QuestionCard key={q.id} compact item={q} />
        ))}
      {stuck && <StuckLoopCard runId={run.id} node={nodeLabels(graph?.document)[stuck.nodeKey] ?? stuck.nodeKey} loop={stuck.edgeKey} attempts={stuck.attempts} />}
      {run.status === "failed" && failed && !stuck && (
        <FailedRunCard
          compact
          item={{ runId: run.id, projectId: project.id, task: run.task, projectName: project.name, executionId: failed.id, nodeKey: failed.nodeKey, attempt: failed.attempt, error: failed.error ?? null }}
        />
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
  const totalCost = executions.reduce((sum, e) => sum + Number(e.costUsd ?? 0), 0);
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader
        crumbs={[...(await projectCrumbs(getDb(), project)), projectRunsCrumb(project.id), await runCrumb(getDb(), project.id, run)]}
        title={<span className="whitespace-pre-line">{run.task}</span>}
        description={
          <div className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs [&_svg]:size-[13px] [&_svg]:shrink-0">
            {/* A task made from the issues' titles already names them; then only the numbers are linked. */}
            <IssueLinks variant="meta" issues={run.issues} showTitles={!run.issues.every((i) => run.task.includes(`#${i.number} ${i.title}`))} />
            {graph && (
              <Link href={`/projects/${project.id}/graphs/${graph.name}`} className="inline-flex items-center gap-[5px] hover:text-foreground hover:underline hover:underline-offset-3">
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
        }
        actions={
          <>
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
            {active ? <CancelRunButton runId={run.id} /> : !project.isDemo && <RunAgainButton runId={run.id} />}
          </>
        }
      />
      <RunAlerts detail={detail} stuck={stuck} />
      <RunLive
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
        initialEvents={events}
        graphDocument={graph?.document}
      />
    </main>
  );
}
