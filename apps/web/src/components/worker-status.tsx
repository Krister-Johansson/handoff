import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/lib/db";
import { workerSummary } from "@/server/workers";
import { WorkerStatusView } from "./worker-status-view";

async function WorkerStatusData() {
  await connection();
  const summary = await workerSummary(getDb()).catch(() => ({ live: 0, queuedRuns: 0 }));
  return <WorkerStatusView live={summary.live} queuedRuns={summary.queuedRuns} />;
}

export function WorkerStatus() {
  return (
    <Suspense fallback={null}>
      <WorkerStatusData />
    </Suspense>
  );
}
