import { ChevronRightIcon } from "lucide-react";
import { formatCost, formatDuration } from "@/lib/format";
import { statusTone, type StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-badge";
import { Tag } from "@/components/tag";

export type StepView = {
  id: string;
  nodeKey: string;
  attempt: number;
  status: string;
  costUsd: string | null;
  durationMs: number | null;
  summary?: string | undefined;
  error?: string | undefined;
  /** The edge that started this execution, when an edge did. */
  via?: string | null | undefined;
};

const DOT: Record<StatusTone, string> = {
  success: "bg-success-dot",
  active: "bg-active-dot animate-pulse",
  attention: "bg-attention-dot",
  danger: "bg-danger-dot",
  repaired: "bg-repaired-dot",
  muted: "bg-muted-foreground/50",
  neutral: "bg-muted-foreground/50",
};

function outcome(step: StepView): { text: string; danger?: boolean } | undefined {
  if (step.error) return { text: step.error, danger: true };
  if (step.summary) return { text: step.summary };
  if (step.status === "running") return { text: "Working…" };
  if (step.status === "waiting") return { text: "Waiting…" };
  if (step.status === "pending") return { text: "Queued" };
  return undefined;
}

/**
 * The run's executions in order on a rail, each with its outcome in one line; selecting one opens its
 * details, and the open one stays marked.
 */
export function Steps({
  steps,
  labels,
  loopEdges,
  selectedId,
  onSelect,
}: {
  steps: StepView[];
  labels: Record<string, string>;
  /** Edges that send work back; a step one of them started names it, while forward edges go unnamed. */
  loopEdges?: ReadonlySet<string>;
  selectedId?: string | null | undefined;
  onSelect: (id: string) => void;
}) {
  if (steps.length === 0) return <p className="px-2.5 py-2 text-sm text-muted-foreground">No steps yet.</p>;
  return (
    <ol className="flex flex-col">
      {steps.map((step, i) => {
        const line = outcome(step);
        const label = labels[step.nodeKey] ?? step.nodeKey;
        const meta = [formatDuration(step.durationMs), formatCost(step.costUsd)].filter(Boolean).join(" · ");
        const selected = step.id === selectedId;
        return (
          <li key={step.id} className="grid grid-cols-[16px_minmax(0,1fr)] gap-3">
            <span aria-hidden className="relative flex justify-center">
              {/* The rail down to the next step's dot */}
              {i < steps.length - 1 && <span className="absolute top-6 -bottom-1 w-px bg-border" />}
              <span className={cn("relative top-[15px] size-[9px] rounded-full ring-3 ring-card", DOT[statusTone(step.status)])} />
            </span>
            <button
              type="button"
              aria-current={selected ? "step" : undefined}
              onClick={() => onSelect(step.id)}
              className={cn(
                // On a phone the time, cost and status wrap under the name and outcome.
                "group my-px flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-2.5 py-[9px] text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:flex-nowrap",
                selected && "bg-muted outline outline-input",
                step.status === "pending" && "opacity-55",
              )}
            >
              <span className="flex min-w-0 flex-[1_1_100%] flex-col gap-px sm:flex-1">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-medium">{label}</span>
                  <span className="font-mono text-xs whitespace-nowrap text-muted-foreground" data-voice-phrase={step.nodeKey}>
                    {step.nodeKey}
                  </span>
                  {step.attempt > 1 && <Tag>{`attempt ${step.attempt}`}</Tag>}
                  {step.via && loopEdges?.has(step.via) && <Tag mono>{`via ${step.via}`}</Tag>}
                </span>
                {line && <span className={cn("mt-px truncate text-[12.5px]", line.danger ? "text-danger" : "text-muted-foreground")}>{line.text}</span>}
              </span>
              {meta && <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums">{meta}</span>}
              <StatusBadge status={step.status} />
              <ChevronRightIcon aria-hidden className={cn("hidden size-4 shrink-0 text-muted-foreground sm:block", selected ? "opacity-100" : "opacity-0 group-hover:opacity-100")} />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
