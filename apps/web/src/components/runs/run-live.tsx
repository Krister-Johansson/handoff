"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RunGraph, type NodeStatus } from "@/components/graph-editor/run-graph";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Maximize2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { describeNow } from "@/lib/run-now";
import { runStatusFromEvent, statusFromEvent, TONE_CLASS } from "@/lib/status";
import { cn } from "@/lib/utils";
import { EventStream, type RunEvent } from "./event-stream";
import { ExecutionPanel } from "./execution-panel";
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
  // Claude CLI events from the live stream, for the drawer's activity of a node that is still running.
  const [liveCli, setLiveCli] = useState<RunEvent[]>([]);
  const router = useRouter();

  const onEvent = useCallback(
    (event: RunEvent) => {
      if (event.type.startsWith("cli.") && event.nodeExecutionId) setLiveCli((list) => [...list.slice(-3_000), event]);
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
  // A popped-out node shows in a large modal instead of the drawer; closing it goes back to the drawer.
  const [poppedOut, setPoppedOut] = useState(false);
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
      <Sheet open={selected !== undefined && !poppedOut} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-xl">
          {selected && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-1 pr-8">
                  <SheetTitle className="mr-auto">{labels[selected.nodeKey] ?? selected.nodeKey}</SheetTitle>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Pop out" onClick={() => setPoppedOut(true)}>
                    <Maximize2Icon />
                  </Button>
                </div>
                <SheetDescription>What this execution produced, the checks the engine ran on it, and what the agent did.</SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-6">
                <ExecutionPanel runId={runId} executionId={selected.id} status={selected.status} liveCli={liveCli} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      <Dialog open={selected !== undefined && poppedOut} onOpenChange={(open) => !open && setPoppedOut(false)}>
        <DialogContent className="h-[90dvh] content-start sm:max-w-[min(96vw,90rem)]">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{labels[selected.nodeKey] ?? selected.nodeKey}</DialogTitle>
                <DialogDescription>What this execution produced, the checks the engine ran on it, and what the agent did.</DialogDescription>
              </DialogHeader>
              <ExecutionPanel runId={runId} executionId={selected.id} status={selected.status} liveCli={liveCli} wide />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
