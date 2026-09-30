"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RunGraph, type NodeStatus } from "@/components/graph-editor/run-graph";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCost, formatDuration } from "@/lib/format";
import { runStatusFromEvent, statusFromEvent } from "@/lib/status";
import { EventStream, type RunEvent } from "./event-stream";
import { ExecutionDetails, type ExecutionDetail } from "./execution-details";
import { StatusBadge } from "./status-badge";

export type ExecutionView = { id: string; nodeKey: string; attempt: number; status: string; costUsd: string | null; durationMs: number | null };

/** Keeps the node table and run status in step with the event stream. */
export function RunLive({
  runId,
  initialStatus,
  initialExecutions,
  initialEvents,
  graphDocument,
}: {
  runId: string;
  graphDocument?: unknown;
  initialStatus: string;
  initialExecutions: ExecutionView[];
  initialEvents: RunEvent[];
}) {
  const [status, setStatus] = useState(initialStatus);
  const [executions, setExecutions] = useState(initialExecutions);

  const router = useRouter();

  const onEvent = useCallback((event: RunEvent) => {
    const runStatus = runStatusFromEvent(event.type);
    if (runStatus) setStatus(runStatus);
    // The server-rendered header (cost, duration, PR, Cancel or Run again) only changes when the run ends.
    if (runStatus === "succeeded" || runStatus === "failed" || runStatus === "cancelled") router.refresh();
    if (event.type === "node.waiting") setStatus((s) => (s === "running" ? "waiting" : s));
    if (event.type === "node.claimed") setStatus("running");
    const next = statusFromEvent(event.type);
    if (!next || !event.nodeExecutionId) return;
    const payload = (event.payload ?? {}) as { nodeKey?: string; attempt?: number; costUsd?: number; durationMs?: number };
    const measured = {
      ...(payload.costUsd !== undefined ? { costUsd: String(payload.costUsd) } : {}),
      ...(payload.durationMs !== undefined ? { durationMs: payload.durationMs } : {}),
    };
    setExecutions((current) => {
      const exists = current.some((e) => e.id === event.nodeExecutionId);
      if (exists) return current.map((e) => (e.id === event.nodeExecutionId ? { ...e, status: next, ...measured } : e));
      return [
        ...current,
        { id: event.nodeExecutionId!, nodeKey: payload.nodeKey ?? "?", attempt: payload.attempt ?? 1, status: next, costUsd: null, durationMs: null, ...measured },
      ];
    });
  }, [router]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = executions.find((e) => e.id === selectedId);
  const selectLatest = useCallback(
    (nodeKey: string) => {
      const latest = executions.findLast((e) => e.nodeKey === nodeKey);
      if (latest) setSelectedId(latest.id);
    },
    [executions],
  );

  const statuses = useMemo(() => {
    const byNode: Record<string, NodeStatus> = {};
    for (const e of executions) byNode[e.nodeKey] = { status: e.status, attempts: (byNode[e.nodeKey]?.attempts ?? 0) + 1 };
    return byNode;
  }, [executions]);

  return (
    <div className="flex flex-col gap-6">
      {graphDocument !== undefined && <RunGraph document={graphDocument} statuses={statuses} onNodeClick={selectLatest} />}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              Nodes <StatusBadge status={status} />
            </CardTitle>
            <CardDescription>Executions in the order they were created.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Node</TableHead>
                  <TableHead>Attempt</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead title="Client-side estimate reported by the Claude CLI">Cost</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {executions.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">
                      <button type="button" className="text-left hover:underline" onClick={() => setSelectedId(e.id)}>
                        {e.nodeKey}
                        <span className="sr-only">, attempt {e.attempt}: show details</span>
                      </button>
                    </TableCell>
                    <TableCell className="tabular-nums">{e.attempt}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">{formatDuration(e.durationMs)}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{formatCost(e.costUsd)}</TableCell>
                    <TableCell className="text-right">
                      <StatusBadge status={e.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Events</CardTitle>
            <CardDescription>Engine and Claude CLI events, live.</CardDescription>
          </CardHeader>
          <CardContent>
            <EventStream runId={runId} initialEvents={initialEvents} onEvent={onEvent} />
          </CardContent>
        </Card>
      </div>
      <Sheet open={selected !== undefined} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.nodeKey}</SheetTitle>
                <SheetDescription>What this execution produced, and the checks the engine ran on it.</SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-6">
                <ExecutionPanel runId={runId} executionId={selected.id} status={selected.status} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Loads one execution's details, and again whenever its status changes. */
function ExecutionPanel({ runId, executionId, status }: { runId: string; executionId: string; status: string }) {
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
  return <ExecutionDetails detail={loaded.detail} />;
}
