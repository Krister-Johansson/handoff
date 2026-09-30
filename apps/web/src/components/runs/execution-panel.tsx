"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { RunEvent } from "./event-stream";
import { ExecutionActivity } from "./execution-activity";
import { ExecutionDetails, type ExecutionDetail } from "./execution-details";

/** Node types that run a Claude Code agent, whose activity is shown. */
const AGENT_TYPES = new Set(["planner", "coder", "reviewer", "code_review"]);

type Props = { runId: string; executionId: string; status: string; liveCli: RunEvent[]; wide?: boolean };

/** One execution's details, loaded again whenever its status changes, with its agent's activity beside or below. */
export function ExecutionPanel({ runId, executionId, status, liveCli, wide = false }: Props) {
  const [loaded, setLoaded] = useState<{ key: string; detail: ExecutionDetail | null }>();
  const key = `${executionId}:${status}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/runs/${runId}/executions/${executionId}`, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<ExecutionDetail>) : null))
      .then((detail) => setLoaded({ key, detail }))
      .catch(() => {});
    return () => controller.abort();
  }, [runId, executionId, key]);
  if (!loaded) return <Skeleton className="h-40 w-full" />;
  if (!loaded.detail) return <p className="text-sm text-muted-foreground">This execution could not be loaded.</p>;
  const agent = AGENT_TYPES.has(loaded.detail.nodeType);
  return (
    <div className={cn("grid gap-6", wide && agent && "lg:grid-cols-2")}>
      <div className="min-w-0">
        <ExecutionDetails detail={loaded.detail} />
      </div>
      {agent && (
        <div className="min-w-0">
          <ExecutionActivity runId={runId} executionId={executionId} live={liveCli.filter((e) => e.nodeExecutionId === executionId)} />
        </div>
      )}
    </div>
  );
}
