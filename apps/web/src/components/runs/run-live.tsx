"use client";

import { useCallback, useMemo, useState, type ComponentProps } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RunGraph, type NodeStatus } from "@/components/graph-editor/run-graph";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Maximize2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCost, formatDuration } from "@/lib/format";
import { reviewPath } from "@/lib/paths";
import { describeNow } from "@/lib/run-now";
import { runStatusFromEvent, statusFromEvent, type StatusTone } from "@/lib/status";
import { loopEdgeKeys } from "@/lib/sent-back";
import { triggeringEdges } from "@/lib/triggering-edges";
import { cn } from "@/lib/utils";
import { QuestionCard, type QuestionItem } from "@/components/inbox/cards";
import { EventStream, type RunEvent } from "./event-stream";
import { ExecutionPanel } from "./execution-panel";
import { StatusBadge } from "./status-badge";
import { Steps, type StepView } from "./steps";
import { Tag } from "@/components/tag";

/** The status banner's border and fill per tone; its text stays the page's foreground. */
const BANNER: Record<StatusTone, string> = {
  success: "border-success-dot/35 bg-success-bg",
  active: "border-active-dot/35 bg-active-bg",
  attention: "border-attention-dot/35 bg-attention-bg",
  danger: "border-danger-dot/35 bg-danger-bg",
  repaired: "border-repaired-dot/35 bg-repaired-bg",
  neutral: "bg-card",
  muted: "bg-card",
};

/** A node's name in the drawer's title: its label, its key, and its attempt after the first. */
function NodeName({ step, label }: { step: StepView; label: string }) {
  return (
    <>
      {label}
      <span className="font-mono text-xs font-normal text-muted-foreground">{step.nodeKey}</span>
      {step.attempt > 1 && <Tag>{`attempt ${step.attempt}`}</Tag>}
    </>
  );
}

/** The line under the drawer's title: status, the edge that started the execution, its time and cost. */
function NodeFacts({ step, className, ...props }: { step: StepView } & ComponentProps<"div">) {
  const facts = [step.via ? `after ${step.via}` : undefined, formatDuration(step.durationMs), formatCost(step.costUsd)].filter(Boolean);
  return (
    // Takes the id and class a dialog description passes on, so the dialog stays described by it.
    <div {...props} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground", className)}>
      <StatusBadge status={step.status} />
      {facts.map((fact) => (
        <span key={fact}>{fact}</span>
      ))}
    </div>
  );
}

export type ExecutionView = StepView;

/** A question a gate waits on, with the execution that asked it. */
export type OpenQuestion = QuestionItem & { nodeExecutionId: string };

type Props = {
  projectId: string;
  runId: string;
  graphDocument?: unknown;
  initialStatus: string;
  initialExecutions: ExecutionView[];
  initialEvents: RunEvent[];
  /** Node labels from the pinned graph, by node key. */
  labels: Record<string, string>;
  prNumber: number | null;
  /** Open questions waiting for a person, each with the execution that asked it. */
  questions: OpenQuestion[];
};

type EventPayload = {
  nodeKey?: string;
  attempt?: number;
  via?: string;
  costUsd?: number;
  durationMs?: number;
  summary?: string;
  error?: { code?: string; message?: string };
};

/** What the run is doing now, its steps, its graph and its events, kept in step with the event stream. */
export function RunLive({ projectId, runId, initialStatus, initialExecutions, initialEvents, graphDocument, labels, prNumber: initialPr, questions }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [prNumber, setPrNumber] = useState(initialPr);
  const [executions, setExecutions] = useState(initialExecutions);
  const [showCli, setShowCli] = useState(false);
  const [nodeFilter, setNodeFilter] = useState("");
  // Claude CLI events from the live stream, for the drawer's activity of a node that is still running.
  const [liveCli, setLiveCli] = useState<RunEvent[]>([]);
  const [eventCount, setEventCount] = useState(initialEvents.length);
  const router = useRouter();
  const loopEdges = useMemo(() => loopEdgeKeys(graphDocument), [graphDocument]);

  const onEvent = useCallback(
    (event: RunEvent) => {
      setEventCount((n) => n + 1);
      if (event.type.startsWith("cli.") && event.nodeExecutionId) setLiveCli((list) => [...list.slice(-3_000), event]);
      const runStatus = runStatusFromEvent(event.type);
      if (runStatus) setStatus(runStatus);
      // The server-rendered header (cost, duration, PR, Cancel or Run again) only changes when the run ends.
      if (runStatus === "succeeded" || runStatus === "failed" || runStatus === "cancelled") router.refresh();
      if (event.type === "node.waiting") {
        setStatus((s) => (s === "running" ? "waiting" : s));
        // A gate's question is read on the server; refreshing brings it to the banner and the drawer.
        router.refresh();
      }
      if (event.type === "node.claimed") setStatus("running");
      // A node that passed and then took a loop edge sent its work back.
      const edgeKey = (event.payload as { edgeKey?: unknown } | null)?.edgeKey;
      if (event.type === "edge.taken" && typeof edgeKey === "string" && loopEdges.has(edgeKey) && event.nodeExecutionId) {
        setExecutions((current) => current.map((e) => (e.id === event.nodeExecutionId ? { ...e, status: "sent_back" } : e)));
      }
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
        return [
          ...current,
          { id: event.nodeExecutionId!, nodeKey: payload.nodeKey ?? "?", attempt: payload.attempt ?? 1, costUsd: null, durationMs: null, via: payload.via ?? null, ...update },
        ];
      });
    },
    [router, loopEdges],
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

  const activeEdges = useMemo(() => triggeringEdges(executions), [executions]);
  const statuses = useMemo(() => {
    const byNode: Record<string, NodeStatus> = {};
    for (const e of executions) byNode[e.nodeKey] = { status: e.status, attempts: (byNode[e.nodeKey]?.attempts ?? 0) + 1 };
    return byNode;
  }, [executions]);

  const review = questions.find((q) => q.context?.review);
  const now = describeNow({ status, executions, labels, prNumber, questions: questions.length, reviews: review ? 1 : 0 });
  const selectedQuestion = questions.find((q) => q.nodeExecutionId === selected?.id);
  const nodeKeys = [...new Set(executions.map((e) => e.nodeKey))];
  const filter = useMemo(
    () => ({ showCli, executionIds: nodeFilter ? new Set(executions.filter((e) => e.nodeKey === nodeFilter).map((e) => e.id)) : undefined }),
    [showCli, nodeFilter, executions],
  );

  const live = status === "queued" || status === "running" || status === "waiting";

  return (
    <div className="flex flex-col gap-6">
      <div role="status" className={cn("flex items-center gap-3 rounded-lg border px-3.5 py-2.5", BANNER[now.tone])}>
        <StatusBadge status={status} />
        <span className="min-w-0 truncate text-sm font-medium">{now.text}</span>
        {review && (
          <Button size="sm" className="ml-auto shrink-0" asChild>
            <Link href={reviewPath(projectId, runId, review.id)}>Open the review</Link>
          </Button>
        )}
      </div>
      <Tabs defaultValue="steps" className="gap-6">
        <TabsList variant="line">
          <TabsTrigger value="steps">Steps</TabsTrigger>
          <TabsTrigger value="graph">Graph</TabsTrigger>
          <TabsTrigger value="events">
            Events
            <span className="inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-secondary px-[5px] text-[11px] font-semibold text-secondary-foreground tabular-nums">
              {eventCount}
            </span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="steps">
          <Card className="py-3">
            <CardContent className="px-3.5">
              <Steps steps={executions} labels={labels} loopEdges={loopEdges} selectedId={selected?.id} onSelect={setSelectedId} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="graph">
          {graphDocument !== undefined && (
            // The run graph draws its own status legend.
            <RunGraph document={graphDocument} statuses={statuses} activeEdges={activeEdges} onNodeClick={selectLatest} className="h-[500px] rounded-lg" />
          )}
        </TabsContent>
        {/* Always mounted: the stream also drives the steps and the banner. */}
        <TabsContent value="events" forceMount className="data-[state=inactive]:hidden">
          <Card className="gap-0 py-0">
            <div className="flex flex-wrap items-center justify-between gap-4 px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-4">
                <Field orientation="horizontal" className="w-auto">
                  <Switch id="events-cli" checked={showCli} onCheckedChange={setShowCli} />
                  <FieldLabel htmlFor="events-cli" className="text-[13px] font-normal">
                    Claude CLI events
                  </FieldLabel>
                </Field>
                <NativeSelect size="sm" aria-label="Node" value={nodeFilter} onChange={(e) => setNodeFilter(e.target.value)} className="min-w-40 text-xs">
                  <NativeSelectOption value="">All nodes</NativeSelectOption>
                  {nodeKeys.map((key) => (
                    <NativeSelectOption key={key} value={key}>
                      {labels[key] ?? key}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              {live && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span aria-hidden className="size-[7px] animate-pulse rounded-full bg-active-dot" />
                  live
                </span>
              )}
            </div>
            <EventStream runId={runId} initialEvents={initialEvents} onEvent={onEvent} filter={filter} className="border-t" />
          </Card>
        </TabsContent>
      </Tabs>
      <Sheet open={selected !== undefined && !poppedOut} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent showCloseButton={false} className="w-full gap-0 bg-card data-[side=right]:sm:max-w-[600px]">
          {selected && (
            <>
              <SheetHeader className="gap-1 border-b px-5 pt-4 pb-3">
                <div className="flex items-center gap-2">
                  <SheetTitle className="flex min-w-0 flex-wrap items-center gap-2 text-[15px] font-semibold">
                    <NodeName step={selected} label={labels[selected.nodeKey] ?? selected.nodeKey} />
                  </SheetTitle>
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Pop out" onClick={() => setPoppedOut(true)}>
                      <Maximize2Icon />
                    </Button>
                    <SheetClose asChild>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="Close">
                        <XIcon />
                      </Button>
                    </SheetClose>
                  </div>
                </div>
                <SheetDescription asChild className="text-xs">
                  <NodeFacts step={selected} />
                </SheetDescription>
              </SheetHeader>
              <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pt-4 pb-6">
                {selectedQuestion && <QuestionCard compact item={selectedQuestion} />}
                <ExecutionPanel runId={runId} executionId={selected.id} status={selected.status} liveCli={liveCli} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      <Dialog open={selected !== undefined && poppedOut} onOpenChange={(open) => !open && setPoppedOut(false)}>
        <DialogContent className="h-[90dvh] content-start bg-card sm:max-w-[min(96vw,90rem)]">
          {selected && (
            <>
              <DialogHeader className="gap-1">
                <DialogTitle className="flex min-w-0 flex-wrap items-center gap-2 text-[15px] font-semibold">
                  <NodeName step={selected} label={labels[selected.nodeKey] ?? selected.nodeKey} />
                </DialogTitle>
                <DialogDescription asChild className="text-xs">
                  <NodeFacts step={selected} />
                </DialogDescription>
              </DialogHeader>
              {selectedQuestion && <QuestionCard compact item={selectedQuestion} />}
              <ExecutionPanel runId={runId} executionId={selected.id} status={selected.status} liveCli={liveCli} wide />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
