import type { ReactNode } from "react";
import Link from "next/link";
import { CircleDotIcon, ListTreeIcon, SearchXIcon } from "lucide-react";
import { SetUpPlanDialog } from "@/components/plan/set-up-plan-dialog";
import { StatusBadge } from "@/components/runs/status-badge";
import { Card } from "@/components/ui/card";
import { issuePath, runPath } from "@/lib/paths";
import type { BacklogIssue } from "@/server/backlog";
import type { IssueWork } from "@/server/overview";
import type { OverviewProject, OverviewStart } from "./project-overview";
import { OverviewSection } from "./overview-section";
import { StartIssueRun } from "./ready";

/**
 * Where the features would be when the plan is missing: no plan yet offers to set one up; a plan that
 * cannot be read says why.
 */
function PlanPointer({ project, work }: { project: OverviewProject; work: IssueWork }) {
  const noPlan = work.reason === "no-plan";
  const Icon = noPlan ? ListTreeIcon : SearchXIcon;
  return (
    <li className="flex items-start gap-3 bg-muted/40 px-4 py-3.5">
      <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground [&_svg]:size-3.5">
        <Icon />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[13px] font-semibold">{noPlan ? "No plan on GitHub yet" : "The plan cannot be read"}</span>
        <p className="text-[13px] text-muted-foreground">{noPlan ? "Link a GitHub Project to follow epics, their progress and the Ready tasks on this page." : work.error}</p>
        {noPlan && (
          <div className="mt-1.5">
            <SetUpPlanDialog project={project} size="sm" />
          </div>
        )}
      </div>
    </li>
  );
}

function IssueRow({ issue, projectId, children }: { issue: BacklogIssue; projectId: string; children?: ReactNode }) {
  const titleId = `issue-${issue.number}`;
  return (
    <li aria-labelledby={titleId} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
      <CircleDotIcon aria-hidden className="size-4 shrink-0 text-success" />
      <div className="flex min-w-0 flex-1 flex-col">
        <Link id={titleId} href={issuePath(projectId, issue.number)} className="truncate text-[13px] font-medium hover:underline hover:underline-offset-3" title={issue.title}>
          <span className="font-mono text-xs font-normal text-muted-foreground">#{issue.number}</span> {issue.title}
        </Link>
        {issue.run?.status === "cancelled" && <span className="text-xs text-muted-foreground">Last run cancelled</span>}
      </div>
      <span className="ml-auto shrink-0">
        {issue.run && issue.run.status !== "cancelled" ? (
          <Link href={runPath(projectId, issue.run.id)} className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <StatusBadge status={issue.run.status} />
          </Link>
        ) : (
          children
        )}
      </span>
    </li>
  );
}

/**
 * The work of a project without a plan: the open issues that have runs, or, when none has, the issues to
 * do with Start run; then the pointer to the plan.
 */
export function IssuesWork({ work, project, start }: { work: IssueWork; project: OverviewProject; start: OverviewStart }) {
  const more = { href: `/projects/${project.id}/issues`, label: "Open Issues" };
  const { issues } = work;
  const withRuns = "error" in issues ? [] : issues.withRuns;
  const toDo = "error" in issues ? [] : issues.toDo;
  const showRuns = withRuns.length > 0;
  return (
    <OverviewSection id="issues" title={showRuns ? "Open issues with runs" : "Issues to do"} count={showRuns ? withRuns.length : toDo.length} more={more}>
      <Card className="gap-0 overflow-hidden py-0">
        <ul className="flex flex-col divide-y">
          {"error" in issues && <li className="px-4 py-3 text-[13px] text-muted-foreground">{issues.error}</li>}
          {showRuns
            ? withRuns.map((issue) => <IssueRow key={issue.number} issue={issue} projectId={project.id} />)
            : toDo.map((issue) => (
                <IssueRow key={issue.number} issue={issue} projectId={project.id}>
                  {issue.blockedBy.length === 0 && <StartIssueRun projectId={project.id} start={start} issue={issue} variant="default" />}
                </IssueRow>
              ))}
          {!("error" in issues) && withRuns.length === 0 && toDo.length === 0 && <li className="px-4 py-3 text-[13px] text-muted-foreground">No open issue to do.</li>}
          <PlanPointer project={project} work={work} />
        </ul>
      </Card>
    </OverviewSection>
  );
}
