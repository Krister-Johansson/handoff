"use client";

import { Fragment, useMemo } from "react";
import { MilestoneIcon } from "lucide-react";
import type { PlanTask } from "@/server/plan";
import { Tag } from "@/components/tag";
import { layoutFlow, type FlowCard } from "@/lib/plan/flow";
import { lowerFirst, runsText, schedulerNote } from "@/lib/plan/flow-text";
import { dueText, flowLineText } from "@/lib/plan/milestone-text";
import { taskColumn } from "@/lib/plan/task";
import { chainPlace } from "@/lib/plan/story-order";
import { itemsOf } from "@/lib/plan/timeline-rows";
import { RowTag, SizeBox, ThenTag } from "./flow-parts";
import { MilestoneChip } from "./milestone-chip";
import type { FlowProps } from "./plan-flow";
import { StatusPill } from "./plan-status";
import { IssueTitle } from "./plan-task-parts";

/** The tags a list item shows after its slot: the row's, without Shaping, which its status pill says. */
const listTags = (tags: string[]) => tags.filter((t) => t !== "Shaping");

/** A running card's steps in words: "3 of 7 steps". */
const stepsOf = (card: FlowCard) => (card.progress && card.progress.total > 0 ? `${card.progress.done} of ${card.progress.total} steps` : undefined);

/**
 * The Flow under 640 px (docs/plans/flow.md, open question 9): one list in order, the running tasks by slot,
 * then the order the scheduler starts tasks in, Ready then Shaping, then the skipped tasks. Each item has its
 * slot, its Next tag, a running task's steps, the row's tags and a Then tag naming the next task of its story,
 * and its milestone unless the filter names it. Filtered to a milestone, a row of its own after its last task
 * says where the order ends it. It does not reorder.
 */
export function PlanFlowList({ epics, unparented, flow: input, scheduler, milestone }: FlowProps) {
  const flow = useMemo(() => layoutFlow(input), [input]);
  // The filters and the search narrow the list; the layout keeps the whole plan.
  const shown = itemsOf(epics, unparented);
  const cards = new Map(flow.cards.map((c) => [c.issue, c]));
  const tags = new Map(flow.rows.map((r) => [r.issue, r.tags]));
  const running = flow.cards.filter((c) => c.kind === "running").map((c) => c.issue);
  const skipped = flow.rows.filter((r) => r.tags.some((t) => t.startsWith("Skipped:"))).map((r) => r.issue);
  const order = [...running, ...flow.queue, ...skipped].flatMap((n) => {
    const item = shown.get(n);
    return item && item.kind !== "epic" && item.kind !== "story" ? [item as PlanTask] : [];
  });
  const note = schedulerNote(flow, scheduler);
  const titles = new Map(input.tasks.map((t) => [t.number, t.title]));
  // The list keeps loadPlan's order, so the milestone's end is the one loadPlan judged.
  const judged = milestone?.progress.flow;
  const line = milestone && judged && flowLineText(milestone.title, judged);

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-col gap-1 border-b px-3.5 py-2.5 text-xs text-muted-foreground">
        <span className="flex flex-wrap gap-x-3">
          <span>{runsText(input.lanes, scheduler)}</span>
          <span>{input.order === "priority" ? "Priority order" : "Project order"}</span>
        </span>
        {note && (
          <Tag tone={note.tone} className="h-auto self-start py-0.5 whitespace-normal">
            {note.text}
          </Tag>
        )}
      </div>
      <ol aria-label="Flow" className="flex flex-col">
        {order.map((task) => {
          const card = cards.get(task.number);
          const steps = card && card.kind === "running" ? stepsOf(card) : undefined;
          // The list draws no arrows, blocker or then, so each task names the next of its story.
          const next = chainPlace(flow.chains, task.number)?.next;
          const ends = line && judged?.last?.issue === task.number;
          return (
            <Fragment key={task.number}>
            <li aria-label={`Task #${task.number} ${task.title}`} className="flex flex-col gap-1.5 border-b px-3.5 py-2.5 last:border-b-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <StatusPill column={taskColumn(task)} />
                <IssueTitle item={task} className="text-xs" />
                <span className="ml-auto">
                  <SizeBox task={task} />
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {card && <Tag className="h-[18px] px-1.5 text-[10.5px]">Slot {card.lane}</Tag>}
                {steps && (
                  <Tag tone="attention" className="h-[18px] px-1.5 text-[10.5px]">
                    {steps}
                  </Tag>
                )}
                {listTags(tags.get(task.number) ?? []).map((t) => (
                  <RowTag key={t} text={t} />
                ))}
                {next !== undefined && <ThenTag issue={next} title={titles.get(next)} />}
                {task.milestone && task.milestone.number !== milestone?.number && <MilestoneChip milestone={task.milestone} />}
              </div>
            </li>
            {ends && (
              <li
                role="separator"
                aria-label={`${line}, ${lowerFirst(dueText(milestone))}`}
                className="flex items-center gap-2 border-t-2 border-b border-dashed border-t-foreground/70 bg-muted/50 px-3.5 py-2 text-xs font-medium [&_svg]:size-3.5 [&_svg]:text-muted-foreground"
              >
                <MilestoneIcon aria-hidden />
                {line}
                <span className="font-normal text-muted-foreground">{dueText(milestone)}</span>
              </li>
            )}
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}
