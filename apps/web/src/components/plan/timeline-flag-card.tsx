"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleAlertIcon } from "lucide-react";
import type { PlanItem } from "@handoff/github";
import type { PlanTask } from "@/server/plan";
import { StatusBadge } from "@/components/runs/status-badge";
import { Tag } from "@/components/tag";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import type { DaySpan, TimelineItem } from "@/lib/plan/schedule";
import { formatDuration } from "@/lib/plan/duration";
import { KIND_NAME, spanText } from "@/lib/plan/timeline-rows";
import { hasActiveRun, taskColumn } from "@/lib/plan/task";
import { issuePath, runPath } from "@/lib/paths";
import { shortDay } from "@/lib/plan/timeline-scale";
import { cn } from "@/lib/utils";
import { KindBadge, StatusPill } from "./plan-status";

/** What the timeline knows beyond the task itself, for its flag card. */
export type FlagContext = {
  projectId: string;
  /** Every item of the plan by number. */
  items: Map<number, PlanItem>;
  /** Every item's place in time by number. */
  entries: Map<number, TimelineItem>;
  needsYou: readonly string[];
};

/** The story or epic whose own dates a task's dates leave, with those dates. */
type Window = { item: PlanItem; span: DaySpan };

const numbers = (list: number[]) => list.map((n) => `#${n}`).join(", ");
const dayCount = (days: number) => (days === 1 ? "1 day" : `${days} days`);
/** Minutes as hours and minutes: "1h 40m". */
const minutesText = (minutes: number) => formatDuration(minutes / 60, Infinity);

/** The nearest story or epic above a task with both a Start and a Target, as the schedule finds it. */
function windowOf(task: PlanTask, ctx: FlagContext): Window | undefined {
  const seen = new Set<number>();
  for (let p = task.parent; p !== undefined && !seen.has(p); p = ctx.items.get(p)?.parent) {
    seen.add(p);
    const span = ctx.entries.get(p)?.planned;
    const item = ctx.items.get(p);
    if (item && span && !span.openStart && !span.openEnd) return { item, span };
  }
  return undefined;
}

/** What a task's warning says, one line each, with the tone of the most urgent. */
function flagsOf(task: PlanTask, entry: TimelineItem, bounds: PlanItem | undefined, waitingOnYou: boolean) {
  const done = taskColumn(task) === "Done";
  const flags = [
    entry.late && `Late: waiting on ${numbers(entry.waitingOn)}`,
    !entry.late && !done && entry.waitingOn.length > 0 && `Blocked by ${numbers(entry.waitingOn)}`,
    entry.overdueDays !== undefined && `Overdue by ${dayCount(entry.overdueDays)}`,
    entry.overForecastMinutes !== undefined && `Over forecast by ${minutesText(entry.overForecastMinutes)}`,
    !entry.late && entry.startsBeforeBlocker.length > 0 && `Starts before ${numbers(entry.startsBeforeBlocker)} ends`,
    entry.outsideParent && `Outside ${bounds?.kind === "epic" ? "epic" : "story"} window`,
    waitingOnYou && "Waiting on you",
  ].filter((f): f is string => Boolean(f));
  const tone = entry.late || entry.startsBeforeBlocker.length > 0 || entry.overForecastMinutes !== undefined ? "text-danger" : entry.overdueDays !== undefined || waitingOnYou ? "text-attention" : "text-muted-foreground";
  return { flags, tone };
}

/** One blocker: number and title linking to its issue page, its kind, its status and whether it is open; or that it is outside the plan. */
function Blocker({ n, task, ctx }: { n: number; task: PlanTask; ctx: FlagContext }) {
  const blocker = ctx.items.get(n);
  const open = blocker ? blocker.state === "open" : task.blockedBy.includes(n);
  return (
    <li aria-label={blocker ? `#${n} ${blocker.title}` : `#${n}`} className="flex flex-wrap items-center gap-1.5">
      <Link href={issuePath(ctx.projectId, n)} className="min-w-0 hover:underline hover:underline-offset-3">
        <span className="font-mono text-muted-foreground">#{n}</span>
        {blocker && ` ${blocker.title}`}
      </Link>
      {blocker ? (
        <>
          {blocker.kind && <KindBadge kind={blocker.kind} />}
          <StatusPill column={blocker.state === "closed" ? "Done" : (blocker.status ?? "Other")} />
        </>
      ) : (
        <span className="text-muted-foreground">Outside the plan</span>
      )}
      <Tag tone={open ? "outline" : "success"}>{open ? "Open" : "Closed"}</Tag>
    </li>
  );
}

/** Late and overdue with the dates they come from, and the window the task's dates leave. */
function TimeRows({ task, entry, bounds, ctx }: { task: PlanTask; entry: TimelineItem; bounds: Window | undefined; ctx: FlagContext }) {
  const ends = (n: number) => ctx.entries.get(n)?.planned?.end;
  return (
    <>
      {entry.late && (
        <>
          <dt className="font-medium text-danger">Late</dt>
          <dd>
            Start was {task.start ? shortDay(task.start) : "not set"}; waits on {numbers(entry.waitingOn)}
          </dd>
        </>
      )}
      {entry.overdueDays !== undefined && (
        <>
          <dt className="font-medium text-attention">Overdue</dt>
          <dd>
            Target was {task.target ? shortDay(task.target) : "not set"}, {dayCount(entry.overdueDays)} ago
          </dd>
        </>
      )}
      {entry.overForecastMinutes !== undefined && (
        <>
          <dt className="font-medium text-danger">Over forecast</dt>
          <dd>The active run is {minutesText(entry.overForecastMinutes)} past the duration its bar shows</dd>
        </>
      )}
      {!entry.late && entry.startsBeforeBlocker.length > 0 && entry.planned && (
        <>
          <dt className="font-medium text-danger">Early</dt>
          <dd>
            Starts {shortDay(entry.planned.start)} before{" "}
            {entry.startsBeforeBlocker.map((n) => `#${n}${ends(n) ? ` ends on ${shortDay(ends(n)!)}` : " ends"}`).join(" and ")}
          </dd>
        </>
      )}
      {bounds && entry.planned && (
        <>
          <dt className="text-muted-foreground">Window</dt>
          <dd>
            {spanText(entry.planned)} leaves {KIND_NAME[bounds.item.kind ?? "story"]} #{bounds.item.number} {bounds.item.title}, {spanText(bounds.span)}
          </dd>
        </>
      )}
    </>
  );
}

/** Every blocker GitHub records, the ones the task waits on and the closed ones alike. */
function BlockerRows({ task, entry, ctx }: { task: PlanTask; entry: TimelineItem; ctx: FlagContext }) {
  const blockers = task.blockers ?? task.blockedBy;
  if (blockers.length === 0) return null;
  return (
    <>
      <dt className="text-muted-foreground">{entry.waitingOn.length > 0 ? "Blocked by" : "Blockers"}</dt>
      <dd>
        <ul className="flex flex-col gap-1">
          {blockers.map((n) => (
            <Blocker key={n} n={n} task={task} ctx={ctx} />
          ))}
        </ul>
      </dd>
    </>
  );
}

/** A run that waits on you, linking to its page where the question or review is, and the active run's state. */
function RunRows({ task, waitingOnYou, projectId }: { task: PlanTask; waitingOnYou: boolean; projectId: string }) {
  const run = task.run;
  if (!run) return null;
  const href = runPath(projectId, run.id);
  const short = run.id.slice(0, 8);
  return (
    <>
      {waitingOnYou && (
        <>
          <dt className="font-medium text-attention">Needs you</dt>
          <dd>
            <Link href={href} className="underline underline-offset-3 hover:text-foreground">
              See what the run waits on
            </Link>
          </dd>
        </>
      )}
      {hasActiveRun(task) && (
        <>
          <dt className="text-muted-foreground">Run</dt>
          <dd>
            <Link href={href} aria-label={`Run ${short}, ${run.status}`} className="inline-flex items-center gap-1.5 rounded-full hover:underline">
              <StatusBadge status={run.status} size="sm" />
              <span className="font-mono text-[11px] text-muted-foreground">{short}</span>
            </Link>
          </dd>
        </>
      )}
    </>
  );
}

/**
 * The warning icon after a task's title on the timeline: blocked, late, overdue or over forecast, starting before a blocker ends, outside its window,
 * or waiting on you. Its accessible name lists the flags. Hover or focus opens a card, in the style
 * of the bar's, with what each flag stands for; Escape closes it, and a tap or a click opens it on
 * touch screens.
 */
export function FlagCard({ task, entry, ctx }: { task: PlanTask; entry: TimelineItem; ctx: FlagContext }) {
  const [open, setOpen] = useState(false);
  const waitingOnYou = task.run !== null && ctx.needsYou.includes(task.run.id);
  const bounds = entry.outsideParent ? windowOf(task, ctx) : undefined;
  const { flags, tone } = flagsOf(task, entry, bounds?.item, waitingOnYou);
  if (flags.length === 0) return null;
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={flags.join(". ")}
          className={cn("-mx-0.5 size-5 shrink-0", tone)}
          onClick={() => setOpen(true)}
          onPointerUp={(e) => e.pointerType === "touch" && setOpen((o) => !o)}
        >
          <CircleAlertIcon />
        </Button>
      </HoverCardTrigger>
      <HoverCardContent role="group" aria-label={`Flags of #${task.number} ${task.title}`} side="bottom"
        align="start"
        collisionPadding={8}
        className="flex w-80 max-w-[calc(100vw-16px)] flex-col gap-2 text-xs"
      >
        <Link href={issuePath(ctx.projectId, task.number)} className="text-[13px] leading-snug font-semibold hover:underline hover:underline-offset-3">
          #{task.number} {task.title}
        </Link>
        <dl className="grid grid-cols-[74px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5">
          <TimeRows task={task} entry={entry} bounds={bounds} ctx={ctx} />
          <BlockerRows task={task} entry={entry} ctx={ctx} />
          <RunRows task={task} waitingOnYou={waitingOnYou} projectId={ctx.projectId} />
        </dl>
      </HoverCardContent>
    </HoverCard>
  );
}
