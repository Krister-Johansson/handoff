"use client";

import { use } from "react";
import { PinIcon, PlusIcon } from "lucide-react";
import type { PlanTask } from "@/server/plan";
import { chipOf } from "@/lib/plan/size-text";
import { cn } from "@/lib/utils";
import { Sizing, type SizingControl } from "./plan-context";

const CHIP = "inline-flex h-5 shrink-0 items-center overflow-hidden rounded-[5px] border text-[11px] leading-none font-medium whitespace-nowrap tabular-nums";

/**
 * A task's size and the duration its bar uses: "M ~50m" from this project's runs, a dotted value for a
 * size's default, dashed for the planner's proposal, a pin for a manual estimate, and "Size" with none.
 * Without the Plan page's forecasts it shows nothing.
 */
export function SizeChip({ task }: { task: PlanTask }) {
  const sizing = use(Sizing);
  if (!sizing) return null;
  return <SizeButton task={task} sizing={sizing} />;
}

function SizeButton({ task, sizing }: { task: PlanTask; sizing: SizingControl }) {
  const chip = chipOf(task, sizing.forecasts, sizing.capacity);
  if (chip.kind === "none") {
    return (
      <button type="button" aria-label={chip.label} className={cn(CHIP, "gap-0.5 border-dashed border-border px-1.5 font-normal text-muted-foreground hover:border-foreground/60 hover:text-foreground [&_svg]:size-[11px]")}>
        <PlusIcon aria-hidden />
        Size
      </button>
    );
  }
  const proposed = chip.kind === "proposal";
  return (
    <button
      type="button"
      aria-label={chip.label}
      title={chip.title}
      className={cn(CHIP, "border-input bg-card text-foreground/80 hover:border-foreground/60 hover:text-foreground", proposed && "border-dashed")}
    >
      {chip.size && (
        <b className={cn("grid min-w-[18px] self-stretch place-items-center bg-secondary px-1 font-mono text-[10.5px] font-semibold text-foreground", proposed && "border-r border-dashed border-input bg-transparent text-foreground/80")}>
          {chip.size}
        </b>
      )}
      <span
        className={cn(
          "inline-flex items-center gap-[3px] pr-1.5 pl-[5px] [&_svg]:size-2.5",
          chip.kind === "estimate" && "font-semibold text-foreground",
          chip.kind === "default" && "text-muted-foreground underline decoration-muted-foreground decoration-dotted underline-offset-2",
        )}
      >
        {chip.kind === "estimate" && <PinIcon aria-hidden />}
        {chip.text}
      </span>
    </button>
  );
}
