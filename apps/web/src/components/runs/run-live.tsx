"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RunGraph, type NodeStatus } from "@/components/graph-editor/run-graph";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { describeNow } from "@/lib/run-now";
import { runStatusFromEvent, statusFromEvent, TONE_CLASS } from "@/lib/status";
import { cn } from "@/lib/utils";
import { EventStream, type RunEvent } from "./event-stream";
import { ExecutionDetails, type ExecutionDetail } from "./execution-details";
import { StatusBadge } from "./status-badge";
import { Steps, type StepView } from "./steps";

export type ExecutionView = StepView;

type Props = {
  runId: string;
  graphDocument?: unknown;
  initialStatus: string;
  initialExecutions: ExecutionView[];
  initialEvents: RunEvent[];
  /** Node labels from the pinned graph, by node key. */
  labels: Record<string, string>;
  prNumber: number | null;
  /** Open questions waiting for a person. */
  questions: number;
};

type EventPayload = { nodeKey?: string; attempt?: number; costUsd?: number; durationMs?: number; summary?: string; error?: { code?: string; message?: string } };

/** What the run is doing now, its steps, its graph and its events, kept in step with the event stream. */
export function RunLive({ runId, initialStatus, initialExecutions, initialEvents, graphDocument, labels, prNumber: initialPr, questions }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [prNumber, setPrNumber] = useState(initialPr);
  const [executions, setExecutions] = useState(initialExecutions);
  const [showCli, setShowCli] = useState(false);
  const [nodeFilter, setNodeFilter] = useState("");
  const router = useRouter();

  const onEvent = useCallback(
    (event: RunEvent) => {
      const runStatus = runStatusFromEvent(event.type);
      if (runStatus) setStatus(runStatus);
      // The server-rendered header (cost, duration, PR, Cancel or Run again) only changes when the run ends.
      if (runStatus === "succeeded" || runStatus === "failed" || runStatus === "cancelled") router.refresh();
      if (event.type === "node.waiting") setStatus((s) => (s === "running" ? "waiting" : s));
      if (event.type === "node.claimed") setStatus("running");
      const prFromEvent = (event.payload as { number?: unknown } | null)?.number;
      if (event.type === "github.pr" && typeof prFromEvent === "number") setPrNumber(prFromEvent);
      const next = statusFromEvent(event.type);
      if (!next || !event.nodeExecutionId) return;
      const payload = (event.payload ?? {}) as EventPayload;
      const update = {
        status: next,
        ...(payload.costUsd !== undefined ? { costUsd: String(payload.costUsd) } : {}),
        ...(payload.durationMs !== undefined ? { durationMs: payload.durationMs } : {}),
        ...(payload.summary !== undefined ? { summary: payload.summary } : {}),
        ...(event.type === "node.failed" && payload.error ? { error: [payload.error.code, payload.error.message].filter(Boolean).join(": ") } : {}),
      };
      setExecutions((current) => {
        if (current.some((e) => e.id === event.nodeExecutionId)) return current.map((e) => (e.id === event.nodeExecutionId ? { ...e, ...update } : e));
        return [...current, { id: event.nodeExecutionId!, nodeKey: payload.nodeKey ?? "?", attempt: payload.attempt ?? 1, costUsd: null, durationMs: null, ...update }];
      });
    },
    [router],
  );

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

  const now = describeNow({ status, executions, labels, prNumber, questions });
  const nodeKeys = [...new Set(executions.map((e) => e.nodeKey))];
  const filter = useMemo(
    () => ({ showCli, executionIds: nodeFilter ? new Set(executions.filter((e) => e.nodeKey === nodeFilter).map((e) => e.id)) : undefined }),
    [showCli, nodeFilter, executions],
  );

  return (
    <div className="flex flex-col gap-4">
      <div role="status" className={cn("flex items-center gap-3 rounded-lg border px-4 py-3", TONE_CLASS[now.tone])}>
        <StatusBadge status={status} />
        <span className="min-w-0 truncate text-sm font-medium">{now.text}</span>
      </div>
      <Tabs defaultValue="steps" className="gap-4">
        <TabsList>
          <TabsTrigger value="steps">Steps</TabsTrigger>
          <TabsTrigger value="graph">Graph</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
        </TabsList>
        <TabsContent value="steps">
          <Card>
            <CardContent>
              <Steps steps={executions} labels={labels} onSelect={setSelectedId} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="graph">
          {graphDocument !== undefined && <RunGraph document={graphDocument} statuses={statuses} onNodeClick={selectLatest} className="h-[28rem]" />}
        </TabsContent>
        {/* Always mounted: the stream also drives the steps and the banner. */}
        <TabsContent value="events" forceMount className="data-[state=inactive]:hidden">
          <Card>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-4">
                <Field orientation="horizontal" className="w-auto">
                  <Switch id="events-cli" checked={showCli} onCheckedChange={setShowCli} />
                  <FieldLabel htmlFor="events-cli" className="font-normal">
                    Claude CLI events
                  </FieldLabel>
                </Field>
                <NativeSelect size="sm" aria-label="Node" value={nodeFilter} onChange={(e) => setNodeFilter(e.target.value)}>
                  <NativeSelectOption value="">All nodes</NativeSelectOption>
                  {nodeKeys.map((key) => (
                    <NativeSelectOption key={key} value={key}>
                      {labels[key] ?? key}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <EventStream runId={runId} initialEvents={initialEvents} onEvent={onEvent} filter={filter} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <Sheet open={selected !== undefined} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{labels[selected.nodeKey] ?? selected.nodeKey}</SheetTitle>
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
