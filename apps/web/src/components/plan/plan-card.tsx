import { InfoIcon } from "lucide-react";
import type { PlanTask } from "@/server/plan";
import { hasActiveRun } from "@/lib/plan/task";
import { TaskActions, type StartRunContext } from "./plan-actions";
import { taskColumn } from "@/lib/plan/task";
import { AssigneeButton } from "./assignee-button";
import { SizeChip } from "./size-chip";
import { MilestoneChip } from "./milestone-chip";
import { BlockedChip, IssueTitle, PrLink, RunCell, TaskTags } from "./plan-task-parts";

/** What a card says when a person moved it on GitHub against its run. */
function movedNote(task: PlanTask): string | undefined {
  const column = taskColumn(task);
  if (column === "Ready" && hasActiveRun(task)) return "Moved here on GitHub. Its run continues, so it stays out of the backlog.";
  if (column === "Running" && !task.run) return "Moved here on GitHub. Nothing starts until someone starts a run.";
  return undefined;
}

/**
 * One task on the board: the epic as a muted eyebrow, the number and title opening the issue on
 * GitHub, then blockers, the run, the pull request and the assignee. The menu has the tree's actions.
 */
export function PlanCard({
  task,
  eyebrow,
  projectId,
  repoUrl,
  needsYou,
  skipped,
  start,
  milestoneShown = false,
}: {
  task: PlanTask;
  eyebrow: string | undefined;
  projectId: string;
  repoUrl: string;
  needsYou: readonly string[];
  skipped?: string | undefined;
  start: StartRunContext;
  /** The filter shows only the task's milestone, so the card does not repeat it. */
  milestoneShown?: boolean;
}) {
  const note = movedNote(task);
  return (
    <li aria-label={`#${task.number} ${task.title}`} className="flex flex-col gap-1.5 rounded-md border bg-card p-2.5 text-[13px] shadow-xs">
      <div className="flex min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1 truncate pt-0.5 text-[11px] text-muted-foreground">{eyebrow}</span>
        <TaskActions task={task} projectId={projectId} start={start} compact />
      </div>
      <IssueTitle item={task} className="line-clamp-2 font-medium whitespace-normal" />
      {note && (
        <p className="flex gap-1.5 text-[11px] leading-snug text-muted-foreground">
          <InfoIcon aria-hidden className="mt-px size-3 shrink-0" />
          {note}
        </p>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 empty:hidden">
        <TaskTags task={task} skipped={skipped} />
        {taskColumn(task) !== "Done" && <BlockedChip blockedBy={task.blockedBy} repoUrl={repoUrl} />}
        <RunCell task={task} projectId={projectId} needsYou={needsYou} />
        <PrLink task={task} repoUrl={repoUrl} />
        {task.milestone && !milestoneShown && <MilestoneChip milestone={task.milestone} />}
        <span className="ml-auto flex items-center gap-1.5 empty:hidden">
          <SizeChip task={task} />
          <AssigneeButton task={task} />
        </span>
      </div>
    </li>
  );
}
