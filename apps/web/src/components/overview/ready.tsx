import Link from "next/link";
import { CircleDotIcon, ListTodoIcon } from "lucide-react";
import { StartRunDialog } from "@/components/projects/forms";
import { BlockedChip } from "@/components/plan/plan-task-parts";
import { StatusPill } from "@/components/plan/plan-status";
import { issuePath } from "@/lib/paths";
import type { ReadyTask } from "@/server/overview";
import type { OverviewStart } from "./project-overview";
import { OverviewEmpty, OverviewList, OverviewSection } from "./overview-section";

/** Start run for an issue, with the issue linked when the dialog opens; nothing without a default graph. */
export function StartIssueRun({
  projectId,
  start,
  issue,
  variant = "outline",
}: {
  projectId: string;
  start: OverviewStart;
  issue: Pick<ReadyTask, "number" | "title" | "url" | "labels" | "updatedAt" | "blockedBy">;
  variant?: "default" | "outline";
}) {
  if (start.graphName === undefined) return null;
  return (
    <StartRunDialog
      projectId={projectId}
      graphs={start.graphs}
      graphName={start.graphName}
      label="Start run"
      variant={variant}
      initialIssues={[{ number: issue.number, title: issue.title, url: issue.url, labels: issue.labels, author: null, updatedAt: issue.updatedAt, blockedBy: issue.blockedBy }]}
    />
  );
}

/**
 * The Ready gate of the backlog: tasks no run works on, those that can start first with Start run, a
 * blocked one with its blocker. A footer counts the unplanned issues that can start from Issues.
 */
export function ReadyToStart({ ready, unplannedToDo, projectId, repoUrl, start }: { ready: ReadyTask[]; unplannedToDo: number; projectId: string; repoUrl: string; start: OverviewStart }) {
  const issuesPath = `/projects/${projectId}/issues`;
  return (
    <OverviewSection id="ready" title="Ready to start" count={ready.length} more={{ href: issuesPath, label: "Open Issues" }}>
      {ready.length === 0 ? (
        <OverviewEmpty icon={ListTodoIcon} title="No task is ready" description="Tasks moved to Ready on the plan show here, ready for a run." />
      ) : (
        <OverviewList>
          {ready.map((task) => (
            <li key={task.number} aria-labelledby={`ready-${task.number}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
              <StatusPill column="Ready" />
              <div className="flex min-w-0 flex-1 flex-col">
                <Link id={`ready-${task.number}`} href={issuePath(projectId, task.number)} className="truncate text-[13px] font-medium hover:underline hover:underline-offset-3" title={task.title}>
                  <span className="font-mono text-xs font-normal text-muted-foreground">#{task.number}</span> {task.title}
                </Link>
                {task.epic && <span className="truncate text-xs text-muted-foreground">{task.epic}</span>}
              </div>
              <span className="ml-auto shrink-0">
                {task.blockedBy.length > 0 ? <BlockedChip blockedBy={task.blockedBy} repoUrl={repoUrl} /> : <StartIssueRun projectId={projectId} start={start} issue={task} />}
              </span>
            </li>
          ))}
          {unplannedToDo > 0 && (
            <li className="flex items-center gap-2 bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
              <CircleDotIcon aria-hidden className="size-3.5" />
              <span>
                <Link href={issuesPath} className="underline underline-offset-3 hover:text-foreground">
                  {unplannedToDo} unplanned {unplannedToDo === 1 ? "issue" : "issues"}
                </Link>{" "}
                outside the plan can start too.
              </span>
            </li>
          )}
        </OverviewList>
      )}
    </OverviewSection>
  );
}
