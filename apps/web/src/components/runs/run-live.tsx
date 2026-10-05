"use client";

import { useCallback, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RunGraph, type NodeStatus } from "@/components/graph-editor/run-graph";
import { PageHeader, type Crumb } from "@/components/page-header";
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
import { reviewPath, tryPath } from "@/lib/paths";
import { describeNow, type RunQueue } from "@/lib/run-now";
import { MergeButton } from "./merge-button";
import { runStatusFromEvent, statusFromEvent, type StatusTone } from "@/lib/status";
import { loopEdgeKeys } from "@/lib/sent-back";
import { triggeringEdges } from "@/lib/triggering-edges";
import { cn } from "@/lib/utils";
import { usePageTools } from "@/lib/assistant/use-page-tools";
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
      <span className="font-mono text-xs font-normal text-muted-foreground" data-voice-phrase={step.nodeKey}>
        {step.nodeKey}
      </span>
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
  /** Where the run stands in its project's merge queue, while it waits there. */
  queue?: RunQueue | undefined;
  /** Open issues GitHub says block this run's issues, while it waits for them at its start. */
  blockedBy?: number[] | undefined;
  /** The page header the run's status sits in: its trail, title, facts and actions. */
  header?: { crumbs: Crumb[]; title: ReactNode; meta: ReactNode; actions: ReactNode };
  /** Cards between the header and the steps, such as a failed run's way to repair it. */
  children?: ReactNode;
  /** The header's Open in VS Code waits for the run's worktree; the first event a step sends from it refreshes the page once. */
  awaitsWorktree?: boolean | undefined;
};

/** Events a step sends once it has its workdir: a fast-forward, the project's setup command, or the CLI. */
const FROM_WORKDIR = /^(workdir|setup|cli)\./;

/** What the run is doing now, on a strip in its tone. */
function RunNow({ status, now }: { status: string; now: ReturnType<typeof describeNow> }) {
  return (
    <div role="status" className={cn("flex h-8 min-w-0 items-center gap-2 rounded-md border pr-3 pl-1.5", BANNER[now.tone])}>
      <StatusBadge size="sm" status={status} />
      <span className="min-w-0 truncate text-[13px] font-medium">{now.text}</span>
    </div>
  );
}

/** The one thing a person can do about the run now: open a waiting review, or merge. */
function RunNowAction({
  projectId,
  runId,
  reviewId,
  tryId,
  queue,
}: {
  projectId: string;
  runId: string;
  reviewId: string | undefined;
  tryId: string | undefined;
  queue: RunQueue | undefined;
}) {
  const canMerge = queue?.position === 1 && queue.mode === "manual" && !queue.requested;
  return (
    <>
      {reviewId && (
        <Button size="sm" className="shrink-0" asChild>
          <Link href={reviewPath(projectId, runId, reviewId)}>Open the review</Link>
        </Button>
      )}
      {tryId && (
        <Button size="sm" className="shrink-0" asChild>
          <Link href={tryPath(projectId, runId, tryId)}>Open Try it</Link>
        </Button>
      )}
      {canMerge && <MergeButton projectId={projectId} runId={runId} />}
    </>
  );
}

/** The run page's views, as its tabs name them. */
const VIEWS = ["steps", "graph", "events"] as const;
type RunView = (typeof VIEWS)[number];
const isView = (value: string): value is RunView => (VIEWS as readonly string[]).includes(value);

/** The sentence a refusal ends with, naming the node keys a page tool can take. */
const stepsList = (keys: string[]) => (keys.length ? `The steps are ${keys.join(", ")}.` : "The run has no steps yet.");

/**
 * The execution a page tool names: an execution id, or a node key with its latest attempt or the
 * attempt asked for. Throws a refusal that lists what there is to choose from.
 */
function findStep(executions: ExecutionView[], step: string, attempt?: number): ExecutionView {
  const byId = executions.find((e) => e.id === step);
  if (byId && attempt === undefined) return byId;
  // With an attempt, an execution id stands for its node.
  const key = byId?.nodeKey ?? step;
  const ofNode = executions.filter((e) => e.nodeKey === key);
  if (ofNode.length === 0) throw new Error(`No step has the key or id ${step}. ${stepsList([...new Set(executions.map((e) => e.nodeKey))])}`);
  if (attempt === undefined) return ofNode.at(-1)!;
  const match = ofNode.findLast((e) => e.attempt === attempt);
  if (!match) throw new Error(`${key} has no attempt ${attempt}. Its attempts are ${ofNode.map((e) => e.attempt).join(", ")}.`);
  return match;
}

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
export function RunLive({
  projectId,
  runId,
  initialStatus,
  initialExecutions,
  initialEvents,
  graphDocument,
  labels,
  prNumber: initialPr,
  questions,
  queue,
  blockedBy,
  header,
  children,
  awaitsWorktree = false,
}: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [prNumber, setPrNumber] = useState(initialPr);
  const [executions, setExecutions] = useState(initialExecutions);
  const [showCli, setShowCli] = useState(false);
  const [nodeFilter, setNodeFilter] = useState("");
  // Claude CLI events from the live stream, for the drawer's activity of a node that is still running.
  const [liveCli, setLiveCli] = useState<RunEvent[]>([]);
  const [eventCount, setEventCount] = useState(initialEvents.length);
  const router = useRouter();
  const worktreeRefreshed = useRef(false);
  const loopEdges = useMemo(() => loopEdgeKeys(graphDocument), [graphDocument]);

  const onEvent = useCallback(
    (event: RunEvent) => {
      setEventCount((n) => n + 1);
      if (event.type.startsWith("cli.") && event.nodeExecutionId) setLiveCli((list) => [...list.slice(-3_000), event]);
      const runStatus = runStatusFromEvent(event.type);
      if (runStatus) setStatus(runStatus);
      // The server-rendered header (cost, duration, PR, Cancel or Run again) only changes when the run ends,
      // and a failed run's cards (repair, a stuck loop) go once a repair or a decision sets it running again.
      if (runStatus === "succeeded" || runStatus === "failed" || runStatus === "cancelled") router.refresh();
      if (event.type === "loop.resolved" || event.type === "node.repair_requested") router.refresh();
      if (event.type === "node.waiting") {
        setStatus((s) => (s === "running" ? "waiting" : s));
        // A gate's question is read on the server; refreshing brings it to the banner and the drawer.
        router.refresh();
      }
      // A step's permission request is read on the server; refreshing shows it with its answers.
      if (event.type === "permission.requested") router.refresh();
      if (awaitsWorktree && !worktreeRefreshed.current && FROM_WORKDIR.test(event.type)) {
        worktreeRefreshed.current = true;
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
    [router, loopEdges, awaitsWorktree],
  );

  const [view, setView] = useState<RunView>("steps");
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
  const tryIt = questions.find((q) => q.context?.reason === "try");
  const now = describeNow({ status, executions, labels, prNumber, questions: questions.length, reviews: review ? 1 : 0, queue, blockedBy });
  const selectedQuestion = questions.find((q) => q.nodeExecutionId === selected?.id);
  const nodeKeys = [...new Set(executions.map((e) => e.nodeKey))];
  const filter = useMemo(
    () => ({ showCli, executionIds: nodeFilter ? new Set(executions.filter((e) => e.nodeKey === nodeFilter).map((e) => e.id)) : undefined }),
    [showCli, nodeFilter, executions],
  );

  const live = status === "queued" || status === "running" || status === "waiting";
  // How a tool's answer names a node: its label, then its key.
  const nodeName = (key: string) => `${labels[key] ?? key} (${key})`;

  usePageTools(
    "run",
    {
      page_show_view: ({ view }) => {
        setView(view);
        return `Showing the ${view} view.`;
      },
      page_open_step: ({ step, attempt }) => {
        const execution = findStep(executions, step, attempt);
        setSelectedId(execution.id);
        return `Opened ${nodeName(execution.nodeKey)}, attempt ${execution.attempt}.`;
      },
      page_close_step: () => {
        setSelectedId(null);
        setPoppedOut(false);
        return selected ? `Closed ${nodeName(selected.nodeKey)}.` : "No step was open.";
      },
      page_pop_out: ({ open }) => {
        if (!selected) throw new Error("No step is open. Open one with page_open_step first.");
        setPoppedOut(open);
        return open ? `Popped out ${nodeName(selected.nodeKey)}.` : `Put ${nodeName(selected.nodeKey)} back in the drawer.`;
      },
      page_filter_events: ({ node, cli }) => {
        if (node && !nodeKeys.includes(node)) throw new Error(`No step has the key ${node}. ${stepsList(nodeKeys)}`);
        // A field left out keeps what the page shows; node null shows every node.
        const nextNode = node === undefined ? nodeFilter : (node ?? "");
        const nextCli = cli ?? showCli;
        setNodeFilter(nextNode);
        setShowCli(nextCli);
        setView("events");
        return `Showing the events of ${nextNode ? nodeName(nextNode) : "every node"}${nextCli ? ", with the Claude CLI's events" : ""}.`;
      },
    },
    () => ({
      runId,
      projectId,
      status,
      view,
      steps: executions.map((e) => ({ id: e.id, nodeKey: e.nodeKey, label: labels[e.nodeKey] ?? e.nodeKey, attempt: e.attempt, status: e.status })),
      openStep: selected ? { id: selected.id, nodeKey: selected.nodeKey, attempt: selected.attempt } : null,
      poppedOut: selected !== undefined && poppedOut,
      events: { node: nodeFilter || null, cli: showCli },
      // The ids answer_question and the other catalog tools take for what waits on a person here.
      questions: questions.map((q) => ({ id: q.id, stepId: q.nodeExecutionId, nodeKey: q.nodeKey, reason: q.reason, question: q.question, options: q.options })),
    }),
  );

  return (
    <div className="flex flex-col gap-6">
      {header ? (
        <PageHeader
          crumbs={header.crumbs}
          title={header.title}
          description={header.meta}
          actions={
            <>
              <RunNow status={status} now={now} />
              <RunNowAction projectId={projectId} runId={runId} reviewId={review?.id} tryId={tryIt?.id} queue={queue} />
              {header.actions}
            </>
          }
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <RunNow status={status} now={now} />
          <RunNowAction projectId={projectId} runId={runId} reviewId={review?.id} tryId={tryIt?.id} queue={queue} />
        </div>
      )}
      {children}
      <Tabs value={view} onValueChange={(value) => isView(value) && setView(value)} className="gap-6">
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
