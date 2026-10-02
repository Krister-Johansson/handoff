import type { Overview } from "@/server/overview";
import { FeaturesInProgress } from "./features";
import { IssuesWork } from "./issues";
import { NeedsYou } from "./needs-you";
import { ReadyToStart } from "./ready";
import { FinishedRuns, RunningNow } from "./overview-runs";

/** The project the Overview is about, with its repository as owner/name. */
export type OverviewProject = { id: string; name: string; repo: string };

/** How a run starts from this page: the project's graphs and the default one; no default, no Start run. */
export type OverviewStart = { graphs: string[]; graphName: string | undefined };

/**
 * A project at a glance, in the order of the questions it answers: what needs you, what runs now, which
 * features move, what is ready to start, and what finished in the last day. From 1024 px the runs sit
 * in the left column and the plan's work in the right; narrower, the sections stack in that order.
 */
export function ProjectOverview({ project, overview, start, now = new Date() }: { project: OverviewProject; overview: Overview; start: OverviewStart; now?: Date }) {
  const repoUrl = `https://github.com/${project.repo}`;
  const { work } = overview;
  return (
    <div className="flex flex-col gap-7">
      <NeedsYou projectId={project.id} view={overview.needsYou} />
      <div className="flex flex-col gap-7 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-5">
        {/* Each column is a stack from 1024 px; narrower, its sections join one list ordered by question. */}
        <div className="contents lg:flex lg:flex-col lg:gap-7">
          <RunningNow runs={overview.running} projectId={project.id} repoUrl={repoUrl} now={now} />
          <div className="order-4 lg:order-none">
            <FinishedRuns runs={overview.finished} projectId={project.id} repoUrl={repoUrl} now={now} />
          </div>
        </div>
        <div className="contents lg:flex lg:flex-col lg:gap-7">
          {work.kind === "plan" ? (
            <>
              <FeaturesInProgress features={work.features} projectId={project.id} repoUrl={repoUrl} />
              <ReadyToStart ready={work.ready} unplannedToDo={work.unplannedToDo} projectId={project.id} repoUrl={repoUrl} start={start} />
            </>
          ) : (
            <IssuesWork work={work} project={project} start={start} />
          )}
        </div>
      </div>
    </div>
  );
}
