import Link from "next/link";
import { CircleAlertIcon, GitPullRequestIcon, HandIcon, LockIcon, RotateCcwIcon } from "lucide-react";
import type { PlanTask } from "@/server/plan";
import { StatusBadge } from "@/components/runs/status-badge";
import { Tag } from "@/components/tag";
import { runPath } from "@/lib/paths";
import { hasActiveRun, hasKindLabel, prNumberOf, taskColumn } from "@/lib/plan/task";

/** "#57 Add the migration", opening the issue's page; the issue pages own it, so the Plan and the issue page link the same way. */
export { IssueTitle } from "@/components/issues/issue-pages";

/**
 * "run running" when an open task's Status disagrees with its active run, which owns Running, or In
 * review once its pull request is open: a card moved on GitHub, or an issue that joined the plan
 * before handoff wrote the run's Status. The page only says so; the next write from the run sets it.
 */
function RunDisagrees({ task }: { task: PlanTask }) {
  const run = task.run;
  if (!run || task.state === "closed" || !hasActiveRun(task)) return null;
  const owned = run.prNumber === null ? "Running" : "In review";
  const column = taskColumn(task);
  if (column === owned) return null;
  const doing = run.prNumber === null ? run.status : `${run.status} with PR #${run.prNumber} open`;
  const rule = run.prNumber === null ? "handoff sets Running while a run works on a task." : "handoff sets In review while a run's pull request is open.";
  return (
    <Tag tone="attention" title={`Status says ${column}, but its run is ${doing}. ${rule}`}>
      <CircleAlertIcon aria-hidden />
      {run.prNumber === null ? `run ${run.status}` : "run in review"}
    </Tag>
  );
}

/**
 * What the row says about the task beyond its status: no kind label, reopened after Done, Running
 * without a run, a Status that disagrees with its active run, and a status write handoff had to skip.
 */
export function TaskTags({ task, skipped }: { task: PlanTask; skipped?: string | undefined }) {
  const column = taskColumn(task);
  return (
    <>
      {!hasKindLabel(task.labels) && <Tag className="border-dashed">no kind label</Tag>}
      <RunDisagrees task={task} />
      {column === "Done" && task.state === "open" && (
        <Tag tone="success" title="Closed, then reopened on GitHub; it keeps Done until someone moves it">
          <RotateCcwIcon aria-hidden />
          reopened
        </Tag>
      )}
      {column === "Running" && !task.run && <Tag title="Moved to Running on GitHub. Nothing starts until someone starts a run.">no run</Tag>}
      {skipped && (
        <Tag tone="attention" title={skipped}>
          <CircleAlertIcon aria-hidden />
          Status not written
        </Tag>
      )}
    </>
  );
}

/** "Blocked by #55, #56" with each blocker linking to its issue, in grey: GitHub's own dependency. */
export function BlockedChip({ blockedBy, repoUrl }: { blockedBy: number[]; repoUrl: string }) {
  if (blockedBy.length === 0) return null;
  return (
    <Tag tone="fill" title="A run can start once these are closed">
      <LockIcon aria-hidden />
      <span>Blocked by</span>
      {blockedBy.map((n, i) => (
        <span key={n}>
          <a href={`${repoUrl}/issues/${n}`} className="font-mono hover:underline">
            #{n}
          </a>
          {i < blockedBy.length - 1 && ","}
        </span>
      ))}
    </Tag>
  );
}

/**
 * The task's latest run: "Needs you" in the warning colour, linking to the project's inbox, while the
 * run waits on a person; otherwise its status badge, linking to the run page.
 */
export function RunCell({ task, projectId, needsYou }: { task: PlanTask; projectId: string; needsYou: readonly string[] }) {
  if (!task.run) return null;
  if (needsYou.includes(task.run.id)) {
    return (
      <Link
        href={`/inbox?${new URLSearchParams({ project: projectId })}`}
        className="inline-flex h-[22px] items-center gap-1.5 rounded-full bg-attention-bg px-2 text-xs font-medium whitespace-nowrap text-attention focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <HandIcon aria-hidden className="size-3" />
        Needs you
      </Link>
    );
  }
  return (
    <Link href={runPath(projectId, task.run.id)} className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      <StatusBadge status={task.run.status} />
    </Link>
  );
}

/** The task's pull request number with its icon, opening it on GitHub. */
export function PrLink({ task, repoUrl }: { task: PlanTask; repoUrl: string }) {
  const pr = prNumberOf(task);
  if (pr === undefined) return null;
  return (
    <a href={`${repoUrl}/pull/${pr}`} aria-label={`PR #${pr}`} className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground hover:underline">
      <GitPullRequestIcon aria-hidden className="size-3.5" />#{pr}
    </a>
  );
}
