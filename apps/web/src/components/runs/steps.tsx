import { ChevronRightIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatCost, formatDuration } from "@/lib/format";
import { statusTone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-badge";

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

const DOT: Record<string, string> = {
  success: "bg-emerald-500",
  active: "bg-sky-500 animate-pulse",
  attention: "bg-amber-500",
  danger: "bg-destructive",
  repaired: "bg-violet-500",
  muted: "bg-muted-foreground/40",
  neutral: "bg-muted-foreground/40",
};

function outcome(step: StepView): { text: string; danger?: boolean } | undefined {
  if (step.error) return { text: step.error, danger: true };
  if (step.summary) return { text: step.summary };
  if (step.status === "running") return { text: "Working…" };
  if (step.status === "waiting") return { text: "Waiting…" };
  if (step.status === "pending") return { text: "Queued" };
  return undefined;
}

/** The run's executions in order, each with its outcome in one line; selecting one opens its details. */
export function Steps({ steps, labels, onSelect }: { steps: StepView[]; labels: Record<string, string>; onSelect: (id: string) => void }) {
  if (steps.length === 0) return <p className="text-sm text-muted-foreground">No steps yet.</p>;
  return (
    <ol className="flex flex-col">
      {steps.map((step, i) => {
        const line = outcome(step);
        const label = labels[step.nodeKey] ?? step.nodeKey;
        const meta = [formatDuration(step.durationMs), formatCost(step.costUsd)].filter(Boolean).join(" · ");
        return (
          <li key={step.id} className="relative flex gap-3">
            {/* The rail between dots */}
            {i < steps.length - 1 && <span aria-hidden className="absolute top-5 bottom-0 left-[7px] w-px bg-border" />}
            <span aria-hidden className={cn("relative mt-3.5 size-[15px] shrink-0 rounded-full border-4 border-background", DOT[statusTone(step.status)])} />
            <button
              type="button"
              onClick={() => onSelect(step.id)}
              className="group mb-1 flex min-w-0 flex-1 items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <span className="font-medium">{label}</span>
                  <span className="font-mono text-xs text-muted-foreground">{step.nodeKey}</span>
                  {step.attempt > 1 && <Badge variant="outline">attempt {step.attempt}</Badge>}
                </span>
                {line && <span className={cn("truncate text-sm", line.danger ? "text-destructive" : "text-muted-foreground")}>{line.text}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                {meta && <span className="text-xs text-muted-foreground tabular-nums">{meta}</span>}
                <StatusBadge status={step.status} />
                <ChevronRightIcon aria-hidden className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
