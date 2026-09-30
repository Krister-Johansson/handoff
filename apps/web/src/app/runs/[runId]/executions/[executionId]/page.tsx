import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { ExecutionView } from "@/components/runs/execution-view";
import { getDb } from "@/lib/db";
import { latestSeq } from "@/server/execution-events";
import { getExecutionDetail } from "@/server/queries";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One execution of a run on a page of its own, wide enough for long output and the agent's activity. */
export default async function ExecutionPage({ params }: { params: Promise<{ runId: string; executionId: string }> }) {
  const { runId, executionId } = await params;
  if (!UUID.test(runId) || !UUID.test(executionId)) notFound();
  const db = getDb();
  const detail = await getExecutionDetail(db, runId, executionId);
  if (!detail) notFound();
  const after = await latestSeq(db, runId);
  return (
    <main className="mx-auto flex w-full max-w-[90rem] flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <Link href={`/runs/${runId}`} className="flex items-center gap-1 text-sm text-muted-foreground hover:underline">
          <ArrowLeftIcon className="size-3.5" />
          Back to the run
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {detail.nodeKey}
          <span className="ml-2 text-base font-normal text-muted-foreground">attempt {detail.attempt}</span>
        </h1>
      </div>
      <ExecutionView runId={runId} executionId={executionId} initialStatus={detail.status} after={after} />
    </main>
  );
}
