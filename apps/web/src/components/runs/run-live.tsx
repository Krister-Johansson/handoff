"use client";

import { useCallback, useMemo, useState } from "react";
import { RunGraph, type NodeStatus } from "@/components/graph-editor/run-graph";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCost, formatDuration } from "@/lib/format";
import { runStatusFromEvent, statusFromEvent } from "@/lib/status";
import { EventStream, type RunEvent } from "./event-stream";
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

  const onEvent = useCallback((event: RunEvent) => {
    const runStatus = runStatusFromEvent(event.type);
    if (runStatus) setStatus(runStatus);
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
  }, []);

  const statuses = useMemo(() => {
    const byNode: Record<string, NodeStatus> = {};
    for (const e of executions) byNode[e.nodeKey] = { status: e.status, attempts: (byNode[e.nodeKey]?.attempts ?? 0) + 1 };
    return byNode;
  }, [executions]);

  return (
    <div className="flex flex-col gap-6">
      {graphDocument !== undefined && <RunGraph document={graphDocument} statuses={statuses} />}
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
                    <TableCell className="font-medium">{e.nodeKey}</TableCell>
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
    </div>
  );
}
