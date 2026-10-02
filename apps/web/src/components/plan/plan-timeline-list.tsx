"use client";

import { useMemo, useState } from "react";
import { CalendarIcon } from "lucide-react";
import type { PlanItem } from "@handoff/github";
import type { PlanTask } from "@/server/plan";
import { Button } from "@/components/ui/button";

import type { TimelineItem } from "@/lib/plan/schedule";
import { COLUMN_TONE, taskColumn } from "@/lib/plan/task";
import { chartRange, itemsOf, KIND_NAME, lacksDateFields, progressOf, scheduleNotes, spanText, stripDates } from "@/lib/plan/timeline-rows";
import { addDays, defaultZoom, timeScale, type TimeScale } from "@/lib/plan/timeline-scale";

import { cn } from "@/lib/utils";
import { KindBadge, StatusPill } from "./plan-status";
import { IssueTitle } from "./plan-task-parts";
import { ScheduleDialog } from "./schedule-dialog";
import { DateFieldsBanner, TimeChips, type TimelineProps } from "./timeline-parts";

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

/**
 * The timeline under 640 px: one row per item in the tree's order with a mini bar, the dates as text,
 * the late, waiting or overdue chips and the latest run's dates. There are no arrows; the chips say
 * what each task waits on.
 */
export function PlanTimelineList({ projectId, project, epics, unparented, timeline, zoom, readAt }: TimelineProps) {
  const [scheduling, setScheduling] = useState<PlanItem>();
  const entries = useMemo(() => new Map(timeline.items.map((i) => [i.number, i])), [timeline.items]);
  const items = useMemo(() => itemsOf(epics, unparented), [epics, unparented]);
  const stories = new Set(epics.flatMap((e) => e.stories.map((s) => s.number)));
  const range = chartRange(timeline);
  const scale = timeScale(range, zoom ?? defaultZoom(range));
  const todayX = scale.xAt(new Date(readAt).toISOString());

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {lacksDateFields(project) && <DateFieldsBanner projectId={projectId} project={project} />}
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
              </div>
              <MiniBar row={row} entry={entry} scale={scale} todayX={todayX} />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="text-foreground tabular-nums">{span ? spanText(span) : "No dates"}</span>
                {progress && (
                  <span>
                    {progress.done} of {progress.total} done
                  </span>
                )}
                {row.task && <TimeChips task={row.task} entry={entry} window={row.item.parent !== undefined && stories.has(row.item.parent) ? "story" : "epic"} waiting />}
                {row.task && <span>{latest ? `Run ${stripDates(latest)}` : "No runs"}</span>}
                {entry.unscheduled && (
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
