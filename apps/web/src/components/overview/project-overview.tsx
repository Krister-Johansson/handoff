import type { Overview } from "@/server/overview";
import { NeedsYou } from "./needs-you";
import { FinishedRuns, RunningNow } from "./overview-runs";

/** The project the Overview is about, with its repository as owner/name. */
export type OverviewProject = { id: string; name: string; repo: string };

/** How a run starts from this page: the project's graphs and the default one; no default, no Start run. */
export type OverviewStart = { graphs: string[]; graphName: string | undefined };

/**
 * A project at a glance, in the order of the questions it answers: what needs you, what runs now, which
 * features move, what is ready to start, and what finished in the last day.
 */
export function ProjectOverview({ project, overview, now = new Date() }: { project: OverviewProject; overview: Overview; start: OverviewStart; now?: Date }) {
  const repoUrl = `https://github.com/${project.repo}`;
  return (
    <div className="flex flex-col gap-7">
      <NeedsYou projectId={project.id} view={overview.needsYou} />
      <RunningNow runs={overview.running} projectId={project.id} repoUrl={repoUrl} now={now} />
      <FinishedRuns runs={overview.finished} projectId={project.id} repoUrl={repoUrl} now={now} />
    </div>
  );
}
