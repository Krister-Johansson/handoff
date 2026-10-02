"use client";

import { useState, useSyncExternalStore, useTransition, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { CalendarClockIcon, CalendarIcon, ClockAlertIcon, InfoIcon,
 LocateFixedIcon, LockIcon, MoveHorizontalIcon, PlusIcon } from "lucide-react";
import type { PlanProject } from "@handoff/github";
import type { PlanEpic, PlanTask } from "@/server/plan";
import { addDateFieldsAction } from "@/app/projects/actions";
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
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { planPath } from "@/lib/paths";
import type { Timeline, TimelineItem } from "@/lib/plan/schedule";
import type { PlanFilters } from "@/lib/plan/filters";
import { BAR_TONE, taskColumn } from "@/lib/plan/task";
import { chartRange } from "@/lib/plan/timeline-rows";
import { defaultZoom, shortDay, timeScale, type Zoom } from "@/lib/plan/timeline-scale";
import { cn } from "@/lib/utils";
import type { StartRunContext } from "./plan-actions";
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

/** The timeline's legend in a popover, with the note that dates move on GitHub's roadmap. */
function Legend() {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="Legend">
              <InfoIcon />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Legend</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-64 gap-2.5 text-xs" aria-label="Legend">
        <PopoverHeader>
          <PopoverTitle className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Legend</PopoverTitle>
        </PopoverHeader>
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
          Drag dates on GitHub&apos;s roadmap. This timeline shows the Project; it does not move dates.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The timeline's controls at the right end of the Plan toolbar: Today, Weeks or Months, and the Legend.
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
        <ToggleGroupItem value="weeks" className={SEGMENTED_ITEM}>
          Weeks
        </ToggleGroupItem>
        <ToggleGroupItem value="months" className={SEGMENTED_ITEM}>
          Months
        </ToggleGroupItem>
      </ToggleGroup>
      <Legend />
    </div>
  );
}

const numbers = (list: number[]) => list.map((n) => `#${n}`).join(", ");

/**
 * What a task says about its time as chips, in the hover card of its bar: late, blocked, overdue, or
 * outside its parent's window.
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

/** A Project without Start or Target: says so and offers to add them, behind a confirmation. */
export function DateFieldsBanner({ projectId, project }: { projectId: string; project: PlanProject }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const add = () =>
    startTransition(async () => {
      const result = await addDateFieldsAction({ projectId });
      if (result.ok) setOpen(false);
      else setError(result.error ?? "GitHub did not add the fields.");
    });
  return (
    <div className="p-2.5">
      <Alert className="border-attention-dot/35 bg-attention-bg sm:pr-40">
        <CalendarIcon className="text-attention" />
        <AlertTitle>This Project has no Start and Target fields</AlertTitle>
        <AlertDescription className="text-xs">GitHub&apos;s roadmap also needs them picked once under &quot;Date fields&quot;.</AlertDescription>
        {/* Under the text on a phone, at the right on wider screens. */}
        <div className="col-start-2 mt-1.5 sm:absolute sm:top-1/2 sm:right-2.5 sm:mt-0 sm:-translate-y-1/2">
          <Button size="sm" onClick={() => setOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            Add date fields
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
            <AlertDialogTitle>Add Start and Target to {project.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              handoff creates two Date fields, Start and Target, on the GitHub Project. Nothing else changes. To see them on GitHub&apos;s roadmap, pick them once under &quot;Date fields&quot;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <FieldError>{error}</FieldError>}
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <Button type="button" disabled={pending} onClick={add}>
              Add date fields
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
