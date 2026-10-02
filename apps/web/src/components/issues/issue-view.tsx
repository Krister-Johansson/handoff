import type { StartRunContext } from "@/components/plan/plan-actions";
import { PlanRefresher } from "@/components/plan/plan-refresher";
import { SidebarSection } from "@/components/sidebar-section";
import type { FoundIssue, IssueRun } from "@/server/issue-page";
import { IssueColumns } from "./issue-columns";
import { IssueHeader } from "./issue-header";
import type { ProjectRef } from "./issue-crumbs";
import { IssuePages } from "./issue-pages";
import { IssueRail } from "./issue-rail";
import { IssueRuns } from "./issue-runs";
import { Comments, Description } from "./issue-text";
import { EpicStories, EpicTimeline, StoryTasks } from "./plan-items";

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
