import { Fragment } from "react";
import { statusTone, type StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { RunStep } from "@/server/run-lines";

const DOT: Record<StatusTone, string> = {
  success: "bg-success-dot",
  active: "bg-active-dot",
  attention: "bg-attention-dot",
  danger: "bg-danger-dot",
  repaired: "bg-repaired-dot",
  neutral: "bg-muted-foreground/50",
  muted: "bg-muted-foreground/50",
};

/** The run's steps so far in order: a dot in the step's colour, its key, and how often it ran when more than once. */
export function StepTrail({ steps }: { steps: RunStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ol aria-label="Steps so far" className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[11px] text-muted-foreground">
      {steps.map((step, i) => (
        <Fragment key={step.nodeKey}>
          {i > 0 && <span aria-hidden className="h-px w-2.5 bg-border" />}
          <li className={cn("inline-flex items-center gap-1.5", step.status !== "passed" && "font-medium text-foreground")}>
            <span aria-hidden className={cn("size-1.5 rounded-full", DOT[statusTone(step.status)])} />
            {step.nodeKey}
            {step.times > 1 && <span className="text-muted-foreground"> ×{step.times}</span>}
          </li>
        </Fragment>
      ))}
    </ol>
  );
}
