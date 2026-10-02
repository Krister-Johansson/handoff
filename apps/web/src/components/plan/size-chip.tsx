"use client";

import { startTransition, use, useOptimistic, useState, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { PinIcon, PlusIcon } from "lucide-react";
import type { PlanTask } from "@/server/plan";
import { setSizeAction } from "@/app/projects/actions";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { chipOf, sumOf, type SizeChange } from "@/lib/plan/size-text";
import { cn } from "@/lib/utils";
import { Sizing, type SizingControl } from "./plan-context";
import { SizePopover, type SizeValue } from "./size-popover";

const CHIP = "inline-flex h-5 shrink-0 items-center overflow-hidden rounded-[5px] border text-[11px] leading-none font-medium whitespace-nowrap tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/**
 * A task's size and the duration its bar uses: "M ~50m" from this project's runs, a dotted value for a
 * size's default, dashed for the planner's proposal, a pin for a manual estimate, and "Size" with none.
 * It opens the size popover. Without the Plan page's forecasts it shows nothing.
 */
export function SizeChip({ task, open, onOpenChange }: { task: PlanTask } & OpenControl) {
  const sizing = use(Sizing);
  if (!sizing) return null;
  return <SizeControl task={task} sizing={sizing} open={open} onOpenChange={onOpenChange} />;
}

/** A popover the page opens from elsewhere too: the timeline opens it with E on a focused bar. */
type OpenControl = { open?: boolean | undefined; onOpenChange?: ((open: boolean) => void) | undefined };

/**
 * The durations of a story's, an epic's or a column's tasks added up, "~" when any part is a forecast and
 * "+1" for each task with neither a size nor an estimate. Nothing when no task has a duration.
 */
export function SizeSum({ tasks, className }: { tasks: readonly PlanTask[]; className?: string }) {
  const sizing = use(Sizing);
  const sum = sizing && sumOf(tasks, sizing.forecasts, sizing.capacity);
  if (!sum) return null;
  return (
    <span title={sum.title} className={cn("shrink-0 text-[11px] font-medium whitespace-nowrap text-muted-foreground tabular-nums", className)}>
      {sum.text}
      {sum.more > 0 && <span className="ml-[3px] text-[10px] text-muted-foreground/70">+{sum.more}</span>}
    </span>
  );
}

const applied =(value: SizeValue, change: SizeChange): SizeValue => ({
  size: change.size === undefined ? value.size : (change.size ?? undefined),
  estimate: change.estimate === undefined ? value.estimate : (change.estimate ?? undefined),
});

/** The chip and its popover: a pick shows at once with a spinner while it saves, and a refusal reopens the popover with the reason. */
function SizeControl({ task, sizing, open: asked, onOpenChange }: { task: PlanTask; sizing: SizingControl } & OpenControl) {
  const router = useRouter();
  const [own, setOwn] = useState(false);
  const open = asked || own;
  const setOpen = (next: boolean) => {
    setOwn(next);
    onOpenChange?.(next);
  };
  const [error, setError] = useState<string>();
  const [value, showValue] = useOptimistic<SizeValue, SizeChange>({ size: task.size, estimate: task.estimate }, applied);
  const [saving, setSaving] = useOptimistic(false);

  const save = (change: SizeChange) => {
    setOpen(false);
    setError(undefined);
    startTransition(async () => {
      showValue(change);
      setSaving(true);
      const result = await setSizeAction({ projectId: sizing.projectId, issue: task.number, ...change });
      startTransition(() => {
        if (result.ok) {
          router.refresh();
          return;
        }
        setError(result.error ?? "GitHub did not take the size.");
        setOpen(true);
      });
    });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(undefined);
      }}
    >
      <PopoverTrigger asChild>
        <ChipButton task={{ ...task, ...value }} sizing={sizing} saving={saving} />
      </PopoverTrigger>
      {open && <SizePopover task={task} value={value} sizing={sizing} error={error} onSave={save} />}
    </Popover>
  );
}

function ChipButton({ task, sizing, saving, ...trigger }: { task: PlanTask; sizing: SizingControl; saving: boolean } & ComponentProps<"button">) {
  const chip = chipOf(task, sizing.forecasts, sizing.capacity);
  if (chip.kind === "none" && !saving) {
    return (
      <button
        type="button"
        {...trigger}
        aria-label={chip.label}
        className={cn(CHIP, "gap-0.5 border-dashed border-border px-1.5 font-normal text-muted-foreground hover:border-foreground/60 hover:text-foreground [&_svg]:size-[11px]")}
      >
        <PlusIcon aria-hidden />
        Size
      </button>
    );
  }
  const proposed = chip.kind === "proposal";
  return (
    <button
      type="button"
      {...trigger}
      aria-label={saving ? `Saving the size of #${task.number} to GitHub` : chip.label}
      aria-busy={saving || undefined}
      title={chip.title}
      className={cn(
        CHIP,
        "border-input bg-card text-foreground/80 hover:border-foreground/60 hover:text-foreground data-[state=open]:border-foreground/60 data-[state=open]:ring-2 data-[state=open]:ring-ring/35",
        proposed && "border-dashed",
      )}
    >
      {chip.size && (
        <b className={cn("grid min-w-[18px] place-items-center self-stretch bg-secondary px-1 font-mono text-[10.5px] font-semibold text-foreground", proposed && "border-r border-dashed border-input bg-transparent text-foreground/80")}>
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
        {saving ? (
          <Spinner aria-hidden className="size-2.5" />
        ) : (
          <>
            {chip.kind === "estimate" && <PinIcon aria-hidden />}
            {chip.text}
          </>
        )}
      </span>
    </button>
  );
}
