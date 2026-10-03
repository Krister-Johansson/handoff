"use client";

import { useId, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { BanIcon, CornerDownRightIcon, GitPullRequestIcon, HandIcon, ListOrderedIcon, LockIcon, MoveHorizontalIcon, PauseIcon, PinIcon, Settings2Icon, TriangleAlertIcon, UserRoundIcon, WaypointsIcon } from "lucide-react";
import type { PlanTask } from "@/server/plan";
import { Tag } from "@/components/tag";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_SIZE } from "@/lib/plan/flow-text";
import { projectSettingsPath } from "@/lib/settings-tab";
import { cn } from "@/lib/utils";
import { LegendPopover } from "./legend-popover";
import { OptimizeControls } from "./plan-toolbar";
import { useStoryOrder } from "./use-story-order";

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

/** One of a row's tags, such as "Next 2", "After #55" or "Skipped: label human"; in Optimize's preview a Next tag adds "was 3". */
export function RowTag({ text, was }: { text: string; was?: number | undefined }) {
  const look = tagLook(text);
  return (
    <Tag
      tone={look.tone}
      title={was === undefined ? look.title : `Optimize moves it from Next ${was}`}
      className={cn("h-[18px] px-1.5 text-[10.5px]", look.dashed && "border-dashed", was !== undefined && "border-active-dot text-active")}
    >
      {look.icon}
      {text}
      {was !== undefined && <span className="font-normal text-muted-foreground">was {was}</span>}
    </Tag>
  );
}

/** The phone list's dashed tag that names the next task of a story, with its title as the tooltip. */
export function ThenTag({ issue, title }: { issue: number; title: string | undefined }) {
  return (
    <Tag title={`Then in its story: #${issue}${title ? ` ${title}` : ""}`} className="h-[18px] border-dashed px-1.5 text-[10.5px]">
      <CornerDownRightIcon aria-hidden />
      Then #{issue}
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

const UNPIN = "Pinned by hand. Click to unpin.";

/** The pin on a pinned card, as a button: a click unpins the task. It sits over the card, not inside its link. */
export function PinButton({ issue, onUnpin, className, style }: { issue: number; onUnpin: (issue: number) => void; className?: string; style?: CSSProperties }) {
  return (
    <button
      type="button"
      aria-label={`Unpin #${issue}`}
      title={UNPIN}
      onClick={() => onUnpin(issue)}
      className={cn(
        "inline-grid size-3.5 shrink-0 place-items-center rounded-[3px] bg-foreground text-background hover:bg-foreground/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-2.5",
        className,
      )}
      style={style}
    >
      <PinIcon aria-hidden />
    </button>
  );
}

/** The Pinned tag in a task's row, as a button: a click unpins the task. */
export function PinnedTag({ issue, onUnpin }: { issue: number; onUnpin: (issue: number) => void }) {
  return (
    <button
      type="button"
      aria-label={`Unpin #${issue}`}
      title={UNPIN}
      onClick={() => onUnpin(issue)}
      className="inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[5px] border border-transparent bg-secondary px-1.5 text-[10.5px] font-medium whitespace-nowrap text-secondary-foreground hover:bg-secondary/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-[11px]"
    >
      <PinIcon aria-hidden />
      Pinned
    </button>
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
const LEGEND: { label: string; title?: string; swatch: ReactNode }[] = [
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
    label: "Then, in its story",
    title: "Each task points to the next task of its story",
    swatch: (
      <svg viewBox="0 0 26 10" className="h-2.5 w-[26px] shrink-0 overflow-visible text-muted-foreground">
        <path d="M1 5 H24" fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="3 2.5" />
        <path d="M20.5 2 L24 5 L20.5 8" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    label: "Placed before its blocker",
    swatch: <span className={cn(SWATCH, "border-active-dot border-l-[5px] border-l-danger-dot bg-active-dot/25")} />,
  },
];

/** The Legend's switch for the then arrows, which this browser remembers. */
function StoryOrderSwitch() {
  const [shown, setShown] = useStoryOrder();
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-2.5">
      <div className="flex flex-col gap-px">
        <label htmlFor={id} className="font-medium text-foreground">
          Show each story&apos;s order
        </label>
        <span id={`${id}-hint`} className="leading-snug text-muted-foreground">
          Then arrows from each task to the next in its story
        </span>
      </div>
      <Switch id={id} aria-describedby={`${id}-hint`} checked={shown} onCheckedChange={setShown} />
    </div>
  );
}

/** The Flow's legend in a popover, with the switch for each story's then arrows. */
function FlowLegend() {
  return (
    <LegendPopover className="w-[330px]">
      <ul className="grid grid-cols-2 gap-x-3 gap-y-2">
        {LEGEND.map((l) => (
          <li key={l.label} title={l.title} className="inline-flex items-center gap-2">
            <span aria-hidden className="inline-flex w-[26px] shrink-0 justify-center">
              {l.swatch}
            </span>
            {l.label}
          </li>
        ))}
      </ul>
      <Separator />
      <StoryOrderSwitch />
      <Separator />
      <p className="flex gap-2 leading-snug text-muted-foreground">
        <MoveHorizontalIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        Length follows the size: S, M or L. Flow has no dates. Drag a Ready card to change the order; it stays pinned.
      </p>
    </LegendPopover>
  );
}

/**
 * The Flow's controls at the right end of the Plan toolbar: the selection and Optimize, Flow mode, which
 * opens the Plan mode settings, and the Legend. Under 640 px the Flow is a list without Optimize.
 */
export function FlowControls({ projectId, narrow = false }: { projectId: string; narrow?: boolean }) {
  return (
    <div className="ml-auto flex items-center gap-1.5">
      {!narrow && <OptimizeControls />}
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
