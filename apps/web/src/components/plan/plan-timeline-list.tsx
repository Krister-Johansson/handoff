"use client";

import { use, useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarIcon, InfoIcon, LockIcon } from "lucide-react";
import type { PlanItem } from "@handoff/github";
import type { PlanTask } from "@/server/plan";
import { moveItemAction } from "@/app/projects/actions";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatDuration } from "@/lib/plan/duration";
import { durationIn, planMove, type MoveContext } from "@/lib/plan/move";

import type { TimelineItem } from "@/lib/plan/schedule";
import { canMove, COLUMN_TONE, taskColumn } from "@/lib/plan/task";
import { chartRange, estimateFieldsGap, itemsOf, KIND_NAME, lacksDateFields, progressOf, scheduleNotes, spanText, stripDates, type ScheduleNote } from "@/lib/plan/timeline-rows";
import { addDays, defaultZoom, shortDay, timeScale, type TimeScale } from "@/lib/plan/timeline-scale";

import { cn } from "@/lib/utils";
import { Sizing } from "./plan-context";
import { KindBadge, StatusPill } from "./plan-status";
import { SizeChip } from "./size-chip";
import { IssueTitle } from "./plan-task-parts";
import { ScheduleDialog } from "./schedule-dialog";
import { FlagCard, type FlagContext } from "./timeline-flag-card";
import { DateFieldsBanner, EstimateFieldsBanner, type TimelineProps } from "./timeline-parts";

type ListRow = { item: PlanItem; kind: "epic" | "story" | "task"; task: PlanTask | undefined; level: 1 | 2 | 3 };

/** Every item in the tree's order, whatever is collapsed in the chart. */
function listRows(epics: TimelineProps["epics"], unparented: PlanTask[]): ListRow[] {
  const taskRow = (task: PlanTask, level: 2 | 3): ListRow => ({ item: task, kind: task.kind === "story" || task.kind === "epic" ? task.kind : "task", task, level });
  return [
    ...epics.flatMap((e) => [
      { item: e, kind: "epic" as const, task: undefined, level: 1 as const },
      ...e.stories.flatMap((s) => [{ item: s, kind: "story" as const, task: undefined, level: 2 as const }, ...s.tasks.map((t) => taskRow(t, 3))]),
      ...e.tasks.map((t) => taskRow(t, 2)),
    ]),
    ...unparented.map((t) => taskRow(t, 2)),
  ];
}

const pct = (scale: TimeScale, x: number) => `${(Math.min(Math.max(x, 0), scale.width) / scale.width) * 100}%`;

/** The planned span against the visible range, 4 px tall, with a tick at today. */
function MiniBar({ row, entry, scale, todayX }: { row: ListRow; entry: TimelineItem; scale: TimeScale; todayX: number }) {
  const span = entry.planned ?? entry.derived;
  const left = span ? scale.x(span.start) : 0;
  const right = span ? scale.x(addDays(span.end, 1)) : 0;
  return (
    <div aria-hidden className="relative h-1 rounded-full bg-muted">
      {span && (
        <span
          className={cn(
            "absolute top-0 h-1 rounded-full",
            row.task ? COLUMN_TONE[taskColumn(row.task)].dot : entry.planned ? "bg-foreground/45" : "border border-dashed border-muted-foreground/60",
          )}
          style={{ left: pct(scale, left), width: `calc(${pct(scale, right)} - ${pct(scale, left)})` }}
        />
      )}
      <span className="absolute -top-[3px] h-2.5 w-0.5 rounded-full bg-foreground" style={{ left: pct(scale, todayX) }} />
    </div>
  );
}

/** Where a task's Target comes from, as the Start field says it: "the M forecast, ~50m", "the manual estimate, 1.5d". */
function sourceText(task: PlanTask, ctx: MoveContext): string {
  const duration = durationIn(ctx, task)!;
  const text = formatDuration(duration.hours, ctx.capacity!);
  switch (duration.source) {
    case "estimate":
      return `the manual estimate, ${text}`;
    case "proposal":
      return `the proposed ${task.proposal?.size}, ~${text}`;
    case "default":
      return `the ${task.size} default, ~${text}`;
    default:
      return `the ${task.size} forecast, ~${text}`;
  }
}

/**
 * A sized task's Start under 640 px, where nothing drags: a button with the Start that opens a date field,
 * and the Target that follows from the duration, after the tasks before it that day. Save writes both.
 */
function StartField({ projectId, task, ctx, notes }: { projectId: string; task: PlanTask; ctx: MoveContext; notes: ScheduleNote[] }) {
  const id = useId();
  const router = useRouter();
  const start = ctx.entries.get(task.number)?.planned?.start ?? task.start;
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(start ?? "");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const plan = day ? planMove(ctx, task, { days: 0, place: day }) : undefined;
  const save = () =>
    plan &&
    startTransition(async () => {
      const result = await moveItemAction({ projectId, issue: task.number, start: plan.start, target: plan.target });
      if (!result.ok) {
        setError(result.error ?? "GitHub did not take the date.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <Button
        size="xs"
        variant="outline"
        className="ml-auto"
        aria-expanded={open}
        aria-label={`Start of #${task.number}, ${start ? shortDay(start) : "not set"}. Change`}
        onClick={() => {
          setOpen(!open);
          setDay(start ?? "");
          setError(undefined);
        }}
      >
        <CalendarIcon data-icon="inline-start" />
        {start ? `Start ${shortDay(start)}` : "Start"}
      </Button>
      {open && (
        <div role="group" aria-label={`New start for #${task.number}`} className="flex basis-full flex-col gap-2 rounded-lg border bg-popover p-3 text-xs shadow-md">
          <Field className="gap-1.5">
            <FieldLabel htmlFor={id}>Start</FieldLabel>
            <Input id={id} type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          {plan?.target && (
            <p className="flex items-start gap-1.5 text-muted-foreground">
              <InfoIcon aria-hidden className="mt-px size-3.5 shrink-0" />
              Target follows from {sourceText(task, ctx)}: {shortDay(plan.target)}.
            </p>
          )}
          {notes
            .filter((n) => n.kind === "blocker")
            .map((note) => (
              <p key={note.text} className="flex items-start gap-1.5 text-muted-foreground">
                <LockIcon aria-hidden className="mt-px size-3.5 shrink-0" />
                {note.text}
              </p>
            ))}
          {error && <FieldError>{error}</FieldError>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!plan || pending} onClick={save}>
              Save to GitHub
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The timeline under 640 px: one row per item in the tree's order with a mini bar, the dates as text
 * and the latest run's dates. Nothing drags; a sized task has its size chip and a Start field instead. There are no arrows; the warning icon after a task's title says what it
 * waits on, and whether it is late or overdue.

 */
export function PlanTimelineList({ projectId, project, epics, unparented, timeline, zoom, readAt, needsYou }: TimelineProps) {
  const sizing = use(Sizing);
  const [scheduling, setScheduling] = useState<PlanItem>();
  const entries = useMemo(() => new Map(timeline.items.map((i) => [i.number, i])), [timeline.items]);
  const items = useMemo(() => itemsOf(epics, unparented), [epics, unparented]);
  const flags: FlagContext = { projectId, items, entries, needsYou };
  const move: MoveContext = { capacity: sizing?.capacity, forecasts: sizing?.forecasts, items, entries };
  const range = chartRange(timeline);
  const scale = timeScale(range, zoom ?? defaultZoom(range));
  const todayX = scale.xAt(new Date(readAt).toISOString());
  const fieldsGap = estimateFieldsGap(project);

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {lacksDateFields(project) && <DateFieldsBanner projectId={projectId} project={project} />}
      {fieldsGap && <EstimateFieldsBanner projectId={projectId} project={project} title={fieldsGap} />}
      <ul aria-label="Timeline">
        {listRows(epics, unparented).map((row) => {
          const entry = entries.get(row.item.number);
          if (!entry) return null;
          const span = entry.planned ?? entry.derived;
          const progress = progressOf(row.item);
          const latest = entry.actual[0];
          return (
            <li
              key={row.item.number}
              aria-label={`${KIND_NAME[row.kind]} #${row.item.number} ${row.item.title}`}
              className={cn("flex flex-col gap-1.5 border-t px-3.5 py-2.5 text-[13px] first:border-t-0", row.level === 2 && "pl-6", row.level === 3 && "pl-[34px]", row.kind === "epic" && "bg-muted/50")}
            >
              <div className="flex min-w-0 items-center gap-2">
                {row.task ? <StatusPill column={taskColumn(row.task)} /> : <KindBadge kind={row.kind === "story" ? "story" : "epic"} />}
                <IssueTitle item={row.item} className="text-xs font-medium" />
                {row.task && <FlagCard task={row.task} entry={entry} ctx={flags} />}
              </div>
              <MiniBar row={row} entry={entry} scale={scale} todayX={todayX} />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="text-foreground tabular-nums">{span ? spanText(span) : "No dates"}</span>
                {progress && (
                  <span>
                    {progress.done} of {progress.total} done
                  </span>
                )}

                {row.task && <span>{latest ? `Run ${stripDates(latest)}` : "No runs"}</span>}
                {row.task && sizing && <SizeChip task={row.task} />}
                {row.task && canMove(row.task) && durationIn(move, row.task) ? (
                  <StartField projectId={projectId} task={row.task} ctx={move} notes={scheduleNotes(row.task, items, entries)} />
                ) : entry.unscheduled && (
                  <Button size="xs" variant="outline" className="ml-auto" aria-label={`Schedule #${row.item.number} ${row.item.title}`} onClick={() => setScheduling(row.item)}>
                    <CalendarIcon data-icon="inline-start" />
                    Schedule
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <ScheduleDialog projectId={projectId} item={scheduling} notes={scheduling ? scheduleNotes(scheduling, items, entries) : []} onOpenChange={(open) => !open && setScheduling(undefined)} />
    </div>
  );
}
