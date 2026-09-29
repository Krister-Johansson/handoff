import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RunLive } from "@/components/runs/run-live";
import { getDb } from "@/lib/db";
import { getRunDetail } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const detail = await getRunDetail(getDb(), runId);
  if (!detail) notFound();
  const { run, project, executions, events } = detail;
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/runs">
            <ArrowLeftIcon data-icon="inline-start" />
            Runs
          </Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{run.task}</CardTitle>
          <CardDescription className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
            <span>
              {project.repoOwner}/{project.repoName}
            </span>
            <span>{run.branchName}</span>
            {run.prNumber !== null && (
              <a className="hover:underline" href={`https://github.com/${project.repoOwner}/${project.repoName}/pull/${run.prNumber}`}>
                PR #{run.prNumber}
              </a>
            )}
          </CardDescription>
        </CardHeader>
      </Card>
      <RunLive
        runId={run.id}
        initialStatus={run.status}
        initialExecutions={executions.map((e) => ({ ...e, status: e.status }))}
        initialEvents={events}
      />
    </main>
  );
}
