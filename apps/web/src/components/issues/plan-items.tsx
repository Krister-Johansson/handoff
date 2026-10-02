"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRightIcon, ChevronRightIcon, ChevronsUpDownIcon, LockIcon } from "lucide-react";
import { TaskActions, type StartRunContext } from "@/components/plan/plan-actions";
import { KindBadge, ProgressBar, StatusPill } from "@/components/plan/plan-status";
import { BlockedChip, IssueTitle, PrLink, RunCell, TaskTags } from "@/components/plan/plan-task-parts";
import { Button } from "@/components/ui/button";
import { planPath } from "@/lib/paths";
import type { Timeline } from "@/lib/plan/schedule";
import { hasActiveRun, taskColumn } from "@/lib/plan/task";
import { cn } from "@/lib/utils";
import type { IssueTask, PlannedEpic } from "@/server/issue-page";
import { IssueSection, Quiet } from "./issue-section";
import { MiniTimeline } from "./mini-timeline";

type RowContext = { projectId: string; repoUrl: string; start: StartRunContext };

/** A task as a row of the Plan tree, with the tree's status pill, blocker chip, run badge or Needs you, and actions; its title wraps to two lines. */
function TaskRow({ task, projectId, repoUrl, start }: { task: IssueTask } & RowContext) {
  const column = taskColumn(task);
  return (
    <li aria-label={`Task #${task.number} ${task.title}, ${column}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 first:pt-0 last:pb-0">
      <span className="w-[86px] shrink-0">
        <StatusPill column={column} spinning={column === "Running" && hasActiveRun(task) && !task.needsYou} />
      </span>
      <span className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
        <IssueTitle item={task} className="line-clamp-2 whitespace-normal" />
        <span className="flex flex-wrap items-center gap-1.5 empty:hidden">
          <TaskTags task={task} />
          {column !== "Done" && <BlockedChip blockedBy={task.blockedBy} repoUrl={repoUrl} />}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-3">
        <RunCell task={task} projectId={projectId} needsYou={task.needsYou && task.run ? [task.run.id] : []} />
        <PrLink task={task} repoUrl={repoUrl} />
        <TaskActions task={task} projectId={projectId} start={start} />
      </span>
    </li>
  );
}

function TaskList({ tasks, ...ctx }: { tasks: IssueTask[] } & RowContext) {
  return (
    <ul className="flex flex-col divide-y">
      {tasks.map((task) => (
        <TaskRow key={task.number} task={task} {...ctx} />
      ))}
    </ul>
  );
}

/** A story's tasks in GitHub's sub-issue order, as in the Plan tree with the same actions. */
export function StoryTasks({ tasks, ...ctx }: { tasks: IssueTask[] } & RowContext) {
  return (
    <IssueSection title="Tasks" count={tasks.length} description="As in the Plan tree, with the same actions.">
      {tasks.length === 0 ? <Quiet>No task under this story yet.</Quiet> : <TaskList tasks={tasks} {...ctx} />}
    </IssueSection>
  );
}

/** An epic's stories collapsed as in the Plan tree, each opening to its tasks, with Expand all. */
export function EpicStories({ place, ...ctx }: { place: PlannedEpic } & RowContext) {
  const { stories, tasks } = place.item;
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const all = open.size === stories.length && stories.length > 0;
  const toggle = (n: number) => setOpen((was) => (was.has(n) ? new Set([...was].filter((x) => x !== n)) : new Set([...was, n])));
  return (
    <IssueSection
      title="Stories and tasks"
      description="As in the Plan tree. Open a story to see its tasks."
      action={
        stories.length > 0 && (
          <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setOpen(all ? new Set() : new Set(stories.map((s) => s.number)))}>
            <ChevronsUpDownIcon data-icon="inline-start" />
            {all ? "Collapse all" : "Expand all"}
          </Button>
        )
      }
    >
      {stories.length === 0 && tasks.length === 0 ? (
        <Quiet>No story under this epic yet.</Quiet>
      ) : (
        <ul className="flex flex-col divide-y">
          {stories.map((story) => {
            const expanded = open.has(story.number);
            const blocked = story.tasks.some((t) => t.state === "open" && t.blockedBy.length > 0);
            return (
              <li key={story.number} className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Close" : "Open"} story #${story.number}`}
                    onClick={() => toggle(story.number)}
                    className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <ChevronRightIcon aria-hidden className={cn("size-4 transition-transform", expanded && "rotate-90")} />
                  </button>
                  <KindBadge kind="story" />
                  <IssueTitle item={story} className="min-w-0 flex-1 basis-40 font-medium" />
                  {blocked && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <LockIcon aria-hidden className="size-3" />
                      Blocked
                    </span>
                  )}
                  <ProgressBar progress={story.progress} className="ml-auto" />
                </span>
                {expanded && <div className="pl-7">{story.tasks.length ? <TaskList tasks={story.tasks} {...ctx} /> : <Quiet>No task under this story yet.</Quiet>}</div>}
              </li>
            );
          })}
          {tasks.length > 0 && (
            <li className="py-2.5 last:pb-0">
              <TaskList tasks={tasks} {...ctx} />
            </li>
          )}
        </ul>
      )}
    </IssueSection>
  );
}

/** An epic's timeline strip: its own dates, each story's span, and Today. */
export function EpicTimeline({ place, timeline, projectId }: { place: PlannedEpic; timeline: Timeline; projectId: string }) {
  return (
    <IssueSection
      title="Timeline"
      action={
        <Link href={planPath(projectId, { view: "timeline", epic: place.item.number })} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline hover:underline-offset-3">
          Open the full timeline
          <ArrowRightIcon aria-hidden className="size-3.5" />
        </Link>
      }
    >
      <MiniTimeline timeline={timeline} rows={[place.item, ...place.item.stories]} />
      <p className="mt-2.5 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-4 rounded-[3px] border border-dashed border-muted-foreground/60" />
          Derived from its tasks
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-4 rounded-[3px] border border-muted-foreground/40 bg-secondary" />
          Own dates
        </span>
      </p>
    </IssueSection>
  );
}
