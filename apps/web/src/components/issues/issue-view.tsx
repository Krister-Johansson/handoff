import type { ReactNode } from "react";
import type { StartRunContext } from "@/components/plan/plan-actions";
import { PlanRefresher } from "@/components/plan/plan-refresher";
import { SidebarSection } from "@/components/sidebar-section";
import type { FoundIssue, IssueRun } from "@/server/issue-page";
import { IssueHeader } from "./issue-header";
import type { ProjectRef } from "./issue-crumbs";
import { IssuePages } from "./issue-pages";
import { IssueRail } from "./issue-rail";
import { IssueRuns } from "./issue-runs";
import { Comments, Description } from "./issue-text";
import { EpicStories, EpicTimeline, StoryTasks } from "./plan-items";

/**
 * The page's two columns. In the DOM the first section comes first, then the rail, then the rest, so
 * below 1024 px the order reads: header, the first section, where the issue sits, the description and
 * the comments. From 1024 px the rail moves to the right of all of them.
 */
export function IssueColumns({ first, rail, rest }: { first: ReactNode; rail: ReactNode; rest: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-4 [grid-template-areas:'first'_'rail'_'rest'] lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[auto_1fr] lg:[grid-template-areas:'first_rail'_'rest_rail']">
      <div className="flex min-w-0 flex-col gap-4 [grid-area:first]">{first}</div>
      {rail}
      <div className="flex min-w-0 flex-col gap-4 [grid-area:rest] lg:self-start">{rest}</div>
    </div>
  );
}

/**
 * One task, story, epic or issue outside the plan, read inside handoff: what GitHub holds next to the
 * runs only handoff knows, with the moves its status allows. A task leads with its runs, a story with
 * its tasks, an epic with its description and its stories.
 */
export function IssueView({
  project,
  page,
  runs,
  start,
  now,
  readAt,
}: {
  project: ProjectRef;
  page: FoundIssue;
  runs: IssueRun[];
  start: StartRunContext;
  now: Date;
  /** When GitHub was read, in epoch milliseconds, for the refresh line. */
  readAt: number;
}) {
  const { issue, place } = page;
  const repoUrl = `https://github.com/${project.repo}`;
  const ctx = { projectId: project.id, repoUrl, start };
  const today = now.toISOString().slice(0, 10);
  const description = (fold: boolean) => <Description key="description" body={issue.body} url={issue.url} fold={fold} projectId={project.id} repoUrl={repoUrl} />;
  const comments = <Comments key="comments" comments={page.comments} url={issue.url} projectId={project.id} repoUrl={repoUrl} />;
  const runList = <IssueRuns key="runs" runs={runs} projectId={project.id} now={now} giveBack={!place.planned} />;
  const [first, rest] =
    place.planned && place.kind === "story"
      ? [<StoryTasks key="tasks" tasks={place.item.tasks} {...ctx} />, [...(runs.length ? [runList] : []), description(true), comments]]
      : place.planned && place.kind === "epic"
        ? [description(true), [<EpicStories key="stories" place={place} {...ctx} />, ...(place.timeline ? [<EpicTimeline key="timeline" place={place} timeline={place.timeline} projectId={project.id} />] : []), comments]]
        : [runList, [description(false), comments]];
  return (
    <IssuePages projectId={project.id}>
      <SidebarSection section={page.section} />
      <div className="flex flex-col gap-5">
        <IssueHeader page={page} project={project} start={start} runs={runs} />
        <IssueColumns first={first} rail={<IssueRail page={page} projectId={project.id} today={today} />} rest={rest} />
        <div className="flex justify-end text-xs text-muted-foreground">
          <PlanRefresher readAt={readAt} />
        </div>
      </div>
    </IssuePages>
  );
}
