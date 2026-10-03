"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { BanIcon, GitPullRequestIcon, HandIcon, ListOrderedIcon, LockIcon, MoveHorizontalIcon, PauseIcon, PinIcon, Settings2Icon, TriangleAlertIcon, UserRoundIcon, WaypointsIcon } from "lucide-react";
import type { PlanTask } from "@/server/plan";
import { Tag } from "@/components/tag";
import { Separator } from "@/components/ui/separator";
import { DEFAULT_SIZE } from "@/lib/plan/flow-text";
import { projectSettingsPath } from "@/lib/settings-tab";
import { cn } from "@/lib/utils";
import { LegendPopover } from "./legend-popover";

/** A row tag's look: its tone and icon, by what it says. */
function tagLook(text: string): {
  tone: "outline" | "fill" | "attention" | "danger";
  icon?: ReactNode;
  title?: string;
  dashed?: boolean;
} {
  const next = /^Next (\d+)$/.exec(text);
  if (next)
    return {
      tone: "outline",
      icon: <ListOrderedIcon aria-hidden />,
      title: `The scheduler starts it as number ${next[1]}`,
    };
  if (text === "Pinned")
    return {
      tone: "fill",
      icon: <PinIcon aria-hidden />,
      title: "Pinned by hand",
    };
  if (text.startsWith("After #")) return { tone: "fill", icon: <LockIcon aria-hidden /> };
  if (text.endsWith(", not in the order")) return { tone: "outline", icon: <LockIcon aria-hidden />, dashed: true };
  if (text === "Waits for the hold") return { tone: "attention", icon: <PauseIcon aria-hidden /> };
  if (text.startsWith("Waits for #"))
    return {
      tone: "danger",
      icon: <TriangleAlertIcon aria-hidden />,
      title: "Placed before its blocker; it still starts after it",
    };
  if (text.startsWith("Waits on you")) return { tone: "attention", icon: <HandIcon aria-hidden /> };
  if (text === "Waits for checks and merge") return { tone: "outline", icon: <GitPullRequestIcon aria-hidden /> };
  if (text.startsWith("Skipped: label"))
    return {
      tone: "outline",
      icon: <UserRoundIcon aria-hidden />,
      dashed: true,
    };
  if (text.startsWith("Skipped:")) return { tone: "outline", icon: <BanIcon aria-hidden />, dashed: true };
  return { tone: "outline" };
}

/** One of a row's tags, such as "Next 2", "After #55" or "Skipped: label human". */
export function RowTag({ text }: { text: string }) {
  const look = tagLook(text);
  return (
    <Tag tone={look.tone} title={look.title} className={cn("h-[18px] px-1.5 text-[10.5px]", look.dashed && "border-dashed")}>
      {look.icon}
      {text}
    </Tag>
  );
}

/** A task's size as a small box; a task without one counts as M and its box is dashed. */
export function SizeBox({ task }: { task: PlanTask }) {
  const size = task.size ?? DEFAULT_SIZE;
  return (
    <span
      title={task.size ? `Size ${size}` : `No size: counts as ${size}`}
      className={cn(
        "inline-grid h-[17px] min-w-[18px] shrink-0 place-items-center rounded-[4px] border border-muted-foreground/40 px-1 font-mono text-[10px] font-semibold text-muted-foreground",
        !task.size && "border-dashed",
      )}
    >
      {size}
    </span>
  );
}

/** The dark square with a pin on a card a person pinned. */
export function PinSquare({ title }: { title?: string }) {
  return (
    <span title={title} className="inline-grid size-3.5 shrink-0 place-items-center rounded-[3px] bg-foreground text-background [&_svg]:size-2.5">
      <PinIcon aria-hidden />
    </span>
  );
}

/** A lane's number on a card, as a small square. */
export function SlotSquare({ lane }: { lane: number }) {
  return (
    <span title={`Slot ${lane}`} className="inline-grid size-3.5 shrink-0 place-items-center rounded-[3px] border bg-card font-mono text-[9.5px] font-semibold text-foreground">
      {lane}
    </span>
  );
}

const SWATCH = "h-3.5 w-[26px] shrink-0 rounded-[4px] border-[1.5px]";
const LEGEND: { label: string; swatch: ReactNode }[] = [
  {
    label: "Running, steps done",
    swatch: <span className={cn(SWATCH, "border-attention-dot bg-attention-dot/60")} />,
  },
  {
    label: "Waits on you",
    swatch: <span className={cn(SWATCH, "border-dashed border-attention-dot bg-attention-dot/30 ring-2 ring-attention-dot/30")} />,
  },
  {
    label: "Next in order",
    swatch: <span className={cn(SWATCH, "border-active-dot bg-active-dot/25")} />,
  },
  {
    label: "Waits for a blocker",
    swatch: <span className={cn(SWATCH, "border-dashed border-muted-foreground/50")} />,
  },
  { label: "Slot", swatch: <SlotSquare lane={2} /> },
  { label: "Pinned", swatch: <PinSquare /> },
  {
    label: "Blocks",
    swatch: <span className="h-0 w-[26px] shrink-0 border-t-[1.5px] border-muted-foreground" />,
  },
  {
    label: "Placed before its blocker",
    swatch: <span className={cn(SWATCH, "border-active-dot border-l-[5px] border-l-danger-dot bg-active-dot/25")} />,
  },
];

/** The Flow's legend in a popover. */
function FlowLegend() {
  return (
    <LegendPopover className="w-75">
      <ul className="grid grid-cols-2 gap-x-3 gap-y-2">
        {LEGEND.map((l) => (
          <li key={l.label} className="inline-flex items-center gap-2">
            <span aria-hidden className="inline-flex w-[26px] shrink-0 justify-center">
              {l.swatch}
            </span>
            {l.label}
          </li>
        ))}
      </ul>
      <Separator />
      <p className="flex gap-2 leading-snug text-muted-foreground">
        <MoveHorizontalIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        Length follows the size: S, M or L. Flow has no dates.
      </p>
    </LegendPopover>
  );
}

/**
 * The Flow's controls at the right end of the Plan toolbar: Flow mode, which opens the Plan mode settings,
 * and the Legend. Optimize joins them before Flow mode.
 */
export function FlowControls({ projectId }: { projectId: string }) {
  return (
    <div className="ml-auto flex items-center gap-1.5">
      <Link
        href={projectSettingsPath(projectId, "mode")}
        title="Plan mode: Flow. Change it in Project settings"
        className="inline-flex h-8 items-center gap-1.5 rounded-md px-1.5 text-xs whitespace-nowrap text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-3.5"
      >
        <WaypointsIcon aria-hidden />
        <span className="underline-offset-3 hover:underline">Flow mode</span>
        <Settings2Icon aria-hidden />
      </Link>
      <FlowLegend />
    </div>
  );
}
