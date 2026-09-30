import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, GitPullRequestIcon } from "lucide-react";
import { GraphDocumentSchema, summarizeOutput } from "@handoff/core";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CancelRunButton, FailedRunCard, QuestionCard } from "@/components/inbox/cards";
import { IssueLinks } from "@/components/runs/issue-links";
import { RunAgainButton } from "@/components/runs/run-again-button";
import { RunLive } from "@/components/runs/run-live";
import { getDb } from "@/lib/db";
import { formatCost, formatDuration } from "@/lib/format";
import { getRunDetail } from "@/server/queries";

export const dynamic = "force-dynamic";

/** Node labels by key from the run's pinned graph document. */
function nodeLabels(document: unknown): Record<string, string> {
  const parsed = GraphDocumentSchema.safeParse(document);
  if (!parsed.success) return {};
  return Object.fromEntries(parsed.data.nodes.map((n) => [n.key, n.attributes.label ?? n.key]));
}

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const detail = await getRunDetail(getDb(), runId);
  if (!detail) notFound();
  const { run, project, executions, events, graph, openQuestions, failed } = detail;
  const active = run.status === "queued" || run.status === "running" || run.status === "waiting";
  const totalCost = executions.reduce((sum, e) => sum + Number(e.costUsd ?? 0), 0);
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/runs">
            <ArrowLeftIcon data-icon="inline-start" />
            Runs
          </Link>
        </Button>
        {active ? <CancelRunButton runId={run.id} /> : !project.isDemo && <RunAgainButton runId={run.id} />}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl whitespace-pre-line">{run.task}</CardTitle>
          {/* A task made from the issues' titles already names them; then only the numbers are linked. */}
          <IssueLinks issues={run.issues} showTitles={!run.issues.every((i) => run.task.includes(`#${i.number} ${i.title}`))} />
          <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <Link href={`/projects/${project.id}`} className="font-medium text-foreground hover:underline">
              {project.name}
            </Link>
            {graph && (
              <Link href={`/projects/${project.id}/graphs/${graph.name}`} className="hover:underline">
                <span className="font-mono">{graph.name}</span> v{graph.version}
              </Link>
            )}
            <span title={run.createdAt.toISOString()}>started {run.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span>
            {run.startedAt && run.finishedAt && <span>took {formatDuration(run.finishedAt.getTime() - run.startedAt.getTime())}</span>}
            {totalCost > 0 && <span title="Client-side estimate reported by the Claude CLI">{formatCost(totalCost)} est.</span>}
          </CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {run.prNumber !== null && (
              <Button size="sm" variant="outline" asChild>
                <a href={`https://github.com/${project.repoOwner}/${project.repoName}/pull/${run.prNumber}`}>
                  <GitPullRequestIcon data-icon="inline-start" />
                  PR #{run.prNumber}
                </a>
              </Button>
            )}
            <a
              className="truncate font-mono text-xs text-muted-foreground hover:underline"
              href={`https://github.com/${project.repoOwner}/${project.repoName}/tree/${run.branchName}`}
            >
              {run.branchName}
            </a>
          </div>
        </CardHeader>
      </Card>
      {openQuestions.map((q) => (
        <QuestionCard
          key={q.id}
          compact
          item={{ ...q, runId: run.id, task: run.task, projectName: project.name, reason: typeof q.context.reason === "string" ? q.context.reason : "approval" }}
        />
      ))}
      {run.status === "failed" && failed && (
        <FailedRunCard
          compact
          item={{ runId: run.id, task: run.task, projectName: project.name, executionId: failed.id, nodeKey: failed.nodeKey, attempt: failed.attempt, error: failed.error ?? null }}
        />
      )}
      <RunLive
        runId={run.id}
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
        questions={openQuestions.length}
        initialEvents={events}
        graphDocument={graph?.document}
      />
    </main>
  );
}
