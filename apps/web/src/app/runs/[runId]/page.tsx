import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CancelRunButton, FailedRunCard, QuestionCard } from "@/components/inbox/cards";
import { RunAgainButton } from "@/components/runs/run-again-button";
import { RunLive } from "@/components/runs/run-live";
import { getDb } from "@/lib/db";
import { formatCost, formatDuration } from "@/lib/format";
import { getRunDetail } from "@/server/queries";

export const dynamic = "force-dynamic";

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
        {active ? <CancelRunButton runId={run.id} /> : <RunAgainButton runId={run.id} />}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{run.task}</CardTitle>
          <CardDescription className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
            <span>
              {project.repoOwner}/{project.repoName}
            </span>
            <span>{run.branchName}</span>
            {totalCost > 0 && <span title="Client-side estimate reported by the Claude CLI">{formatCost(totalCost)} est.</span>}
            {run.startedAt && run.finishedAt && <span>{formatDuration(run.finishedAt.getTime() - run.startedAt.getTime())}</span>}
            {run.prNumber !== null && (
              <a className="hover:underline" href={`https://github.com/${project.repoOwner}/${project.repoName}/pull/${run.prNumber}`}>
                PR #{run.prNumber}
              </a>
            )}
          </CardDescription>
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
        }))}
        initialEvents={events}
        graphDocument={graph?.document}
      />
    </main>
  );
}
