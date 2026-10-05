"use client";

import { useState, useSyncExternalStore, useTransition, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { CalendarClockIcon, CalendarIcon, ClockAlertIcon,
 LocateFixedIcon, LockIcon, MoveHorizontalIcon, PlusIcon, RulerIcon, TimerIcon, TriangleAlertIcon } from "lucide-react";
import type { PlanProject } from "@handoff/github";
import type { PlanEpic, PlanTask } from "@/server/plan";
import { addMissingFields } from "@/components/projects/add-missing-fields";
import { Tag } from "@/components/tag";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { planPath } from "@/lib/paths";
import type { Timeline, TimelineItem } from "@/lib/plan/schedule";
import type { PlanFilters } from "@/lib/plan/filters";
import { formatDuration } from "@/lib/plan/duration";
import { BAR_TONE, taskColumn } from "@/lib/plan/task";
import type { TimelineFieldsGap } from "@/lib/plan/timeline-rows";
import { chartRange } from "@/lib/plan/timeline-rows";
import { defaultZoom, shortDay, timeScale, ZOOMS, type Zoom } from "@/lib/plan/timeline-scale";
import { cn } from "@/lib/utils";
import type { StartRunContext } from "./plan-actions";
import { LegendPopover } from "./legend-popover";
import { SEGMENTED, SEGMENTED_ITEM } from "./segmented";


/** What the chart and the list form both take. */
export type TimelineProps = StartRunContext & {
  projectId: string;
  repoUrl: string;
  /** The plan's GitHub Project: its link, and whether it has the Start and Target fields. */
  project: PlanProject;
  epics: PlanEpic[];
  unparented: PlanTask[];
  timeline: Timeline;
  /** The zoom from ?zoom=; undefined picks one from the visible range. */
  zoom: Zoom | undefined;
  filters: PlanFilters;
  needsYou: string[];
  /** When the page read GitHub, in epoch milliseconds: the Today line. */
  readAt: number;
  /** Where the chart puts its scroll to today, for the toolbar's Today button. */
  todayRef?: RefObject<(() => void) | null> | undefined;
  /** During a search, the rows it opens; the collapse store's rows otherwise. */
  searchOpen?: Set<string> | undefined;
};

const LEGEND: { label: string; swatch: string }[] = [
  ...(["Shaping", "Ready", "Running", "In review", "Done"] as const).map((c) => ({ label: c, swatch: cn("h-2 rounded-[2px] border", BAR_TONE[c]) })),
  { label: "Derived", swatch: "h-2 rounded-[2px] border border-dashed border-muted-foreground/60" },
  { label: "Run", swatch: "h-1 rounded-[2px] bg-active-dot" },
  { label: "Blocks", swatch: "h-0 border-t-[1.5px] border-muted-foreground" },
  { label: "Late", swatch: "h-0 border-t-[1.5px] border-danger-dot" },
];

/** The timeline's legend in a popover, with how bars move. */
function Legend() {
  return (
    <LegendPopover className="w-64">
      <ul className="grid grid-flow-col grid-cols-2 grid-rows-5 gap-x-3 gap-y-1.5">
        {LEGEND.map((l) => (
          <li key={l.label} className="inline-flex items-center gap-2">
            <span aria-hidden className={cn("w-3.5 shrink-0", l.swatch)} />
            {l.label}
          </li>
        ))}
      </ul>
      <Separator />
      <p className="flex gap-2 leading-snug text-muted-foreground">
        <MoveHorizontalIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        Drag a task&apos;s bar to move its Start, or its end to set a manual estimate. Each drop saves to GitHub with Undo.
      </p>
    </LegendPopover>
  );
}

/**
 * The timeline's controls at the right end of the Plan toolbar: Today, Days, Weeks or Months, and the Legend.
 * Under 640 px, where the timeline is a list, the range it shows takes Today's place.
 */
export function TimelineControls({
  projectId,
  filters,
  timeline,
  zoom,
  narrow,
  onToday,
}: {
  projectId: string;
  filters: PlanFilters;
  timeline: Timeline;
  zoom: Zoom | undefined;
  narrow: boolean;
  onToday: () => void;
}) {
  const router = useRouter();
  const range = chartRange(timeline);
  const scale = timeScale(range, zoom ?? defaultZoom(range));
  return (
    <div className={cn("ml-auto flex items-center gap-1.5", narrow && "basis-full")}>
      {narrow ? (
        <span className="mr-auto text-xs whitespace-nowrap text-muted-foreground">
          {shortDay(scale.range.start)} to {shortDay(scale.range.end)}, today {shortDay(timeline.today)}
        </span>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="Today" onClick={onToday}>
              <LocateFixedIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Today</TooltipContent>
        </Tooltip>
      )}
      <ToggleGroup
        type="single"
        spacing={0.5}
        className={SEGMENTED}
        value={scale.zoom}
        onValueChange={(v) => v && router.replace(planPath(projectId, { ...filters, view: "timeline", zoom: v as Zoom }), { scroll: false })}
        aria-label="Zoom"
      >
        {ZOOMS.map((z) => (
          <ToggleGroupItem key={z} value={z} className={SEGMENTED_ITEM}>
            {ZOOM_NAME[z]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Legend />
    </div>
  );
}

const ZOOM_NAME: Record<Zoom, string> = { days: "Days", weeks: "Weeks", months: "Months" };

const numbers = (list: number[]) => list.map((n) => `#${n}`).join(", ");

/**
 * What a task says about its time as chips, in the hover card of its bar: late, blocked, overdue or over
 * forecast, starting before a blocker ends, or outside its parent's window.
 */
export function TimeChips({ task, entry, window }: { task: PlanTask; entry: TimelineItem; window: "story" | "epic" }) {
  const done = taskColumn(task) === "Done";
  const chips = [
    entry.late && (
      <Tag key="late" tone="danger">
        <ClockAlertIcon aria-hidden />
        Late: waiting on {numbers(entry.waitingOn)}
      </Tag>
    ),
    !entry.late && !done && entry.waitingOn.length > 0 && (
      <Tag key="blocked" tone="fill">
        <LockIcon aria-hidden />
        Blocked by {numbers(entry.waitingOn)}

      </Tag>
    ),
    entry.overdueDays !== undefined && (
      <Tag key="overdue" tone="attention">
        <CalendarClockIcon aria-hidden />
        Overdue by {entry.overdueDays === 1 ? "1 day" : `${entry.overdueDays} days`}
      </Tag>
    ),
    entry.overForecastMinutes !== undefined && (
      <Tag key="over" tone="danger">
        <TimerIcon aria-hidden />
        Over forecast by {formatDuration(entry.overForecastMinutes / 60, Infinity)}
      </Tag>
    ),
    !entry.late && entry.startsBeforeBlocker.length > 0 && (
      <Tag key="early" tone="danger">
        <TriangleAlertIcon aria-hidden />
        Starts before {numbers(entry.startsBeforeBlocker)} ends
      </Tag>
    ),
    entry.outsideParent && (
      <Tag key="outside" className="border-dashed">
        <MoveHorizontalIcon aria-hidden />
        Outside {window} window
      </Tag>
    ),
  ].filter(Boolean);
  if (chips.length === 0) return null;
  return <>{chips}</>;
}

const NARROW = "(max-width: 639px)";
function subscribeNarrow(onChange: () => void) {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Whether the window is under 640 px, where the timeline becomes a list; the server renders the chart. */
export const useNarrow = () =>
  useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );

type FieldsBannerProps = {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  /** The button on the banner and in the confirmation. */
  label: string;
  confirmTitle: string;
  confirmDescription: ReactNode;
  add: () => Promise<{ ok?: boolean; error?: string }>;
};

/** A banner that says which fields the Project lacks and offers to add them, behind a confirmation. */
function FieldsBanner({ icon, title, description, label, confirmTitle, confirmDescription, add }: FieldsBannerProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const confirm = () =>
    startTransition(async () => {
      const result = await add();
      if (result.ok) setOpen(false);
      else setError(result.error ?? "GitHub did not add the fields.");
    });
  return (
    <div className="p-2.5">
      <Alert className="border-attention-dot/35 bg-attention-bg sm:pr-40">
        {icon}
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="text-xs">{description}</AlertDescription>
        {/* Under the text on a phone, at the right on wider screens. */}
        <div className="col-start-2 mt-1.5 sm:absolute sm:top-1/2 sm:right-2.5 sm:mt-0 sm:-translate-y-1/2">
          <Button size="sm" onClick={() => setOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            {label}
          </Button>
        </div>
      </Alert>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          setError(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          {error && <FieldError>{error}</FieldError>}
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <Button type="button" disabled={pending} onClick={confirm}>
              {label}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** "Start, Target and Estimate". */
const both = (names: readonly string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? ""));

/**
 * The Timeline's notice for a Project that lacks Start, Target, Size or Estimate, or has a Size field without S,
 * M or L: names what it lacks and offers Add the fields, behind a confirmation, with the same actions as
 * Settings, Projects. Existing fields and Size options stay.
 */
export function TimelineFieldsBanner({ projectId, project, gap }: { projectId: string; project: PlanProject; gap: TimelineFieldsGap }) {
  const dates = gap.adding.includes("Start") || gap.adding.includes("Target");
  return (
    <FieldsBanner
      icon={dates ? <CalendarIcon className="text-attention" /> : <RulerIcon className="text-attention" />}
      title={gap.title}
      description={
        <>
          The missing fields are added to the GitHub Project.
          {dates && <> GitHub&apos;s roadmap also needs Start and Target picked once under &quot;Date fields&quot;.</>}
        </>
      }
      label="Add the fields"
      confirmTitle={`Add ${both(gap.adding)} to ${project.title}?`}
      confirmDescription="handoff creates what the GitHub Project lacks of Start and Target, two Date fields, Size, a single select with S, M and L, and Estimate, a Number field in hours. Existing fields, options and values stay; nothing else changes."
      add={() => addMissingFields(projectId, "timeline", gap.fields)}
    />
  );
}
