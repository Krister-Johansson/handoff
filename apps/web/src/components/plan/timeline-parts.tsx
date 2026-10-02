"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { CalendarClockIcon, CalendarIcon, ClockAlertIcon, LockIcon, MoveHorizontalIcon, PlusIcon } from "lucide-react";
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
import type { Timeline, TimelineItem } from "@/lib/plan/schedule";
import type { PlanFilters } from "@/lib/plan/filters";
import { taskColumn } from "@/lib/plan/task";
import type { Zoom } from "@/lib/plan/timeline-scale";
import type { StartRunContext } from "./plan-actions";

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
};

const numbers = (list: number[]) => list.map((n) => `#${n}`).join(", ");

/**
 * What a task's row says about its time: late, blocked, overdue, or outside its parent's window. The
 * list form, which has no arrows, says "Waiting on #70" where the chart says "Blocked by #70".
 */
export function TimeChips({ task, entry, window, waiting }: { task: PlanTask; entry: TimelineItem; window: "story" | "epic"; waiting?: boolean }) {
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
        {waiting ? "Waiting on" : "Blocked by"} {numbers(entry.waitingOn)}
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
