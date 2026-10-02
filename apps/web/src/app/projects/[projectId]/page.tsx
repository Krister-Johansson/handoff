import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ProjectOverview } from "@/components/overview/project-overview";
import { StartRunDialog } from "@/components/projects/forms";
import { SchedulerLine } from "@/components/scheduler/scheduler-card";
import { getDb } from "@/lib/db";
import { getGitHub, getProjects } from "@/lib/github";
import { oldTabPath } from "@/lib/project-tab";
import { loadOverview } from "@/server/overview";
import { projectPage, repoUrl, sectionCrumbs } from "@/server/project-page";
import { loadSchedulerCard } from "@/server/scheduler-card";

export const dynamic = "force-dynamic";

/**
 * A project's own address: its Home page. A link from before the project's pages became routes carries
 * ?tab= and lands on that tab's route.
 */
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  if (query.tab !== undefined) redirect(oldTabPath(projectId, query));
  const [{ project, graphs, defaultGraph }, overview, scheduler] = await Promise.all([
    projectPage(projectId),
    loadOverview(getDb(), getGitHub(), getProjects(), projectId),
    loadSchedulerCard(getDb(), projectId),
  ]);
  const plan = overview.work.kind === "plan" ? overview.work.project : undefined;
  const repo = `${project.repoOwner}/${project.repoName}`;
  const start = { graphs: graphs.map((g) => g.name), graphName: project.isDemo ? undefined : defaultGraph };
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6 max-sm:px-4">
      <PageHeader
        crumbs={sectionCrumbs(project, "Home")}
        title="Home"
        description={
          <>
            <a className="font-mono text-xs hover:underline hover:underline-offset-3" href={repoUrl(project)}>
              {repo}
            </a>
            {plan && (
              <>
                <span className="text-muted-foreground/60"> · </span>
                plan from{" "}
                <a href={plan.url} className="underline underline-offset-3 hover:text-foreground">
                  {plan.title}
                </a>{" "}
                on GitHub
              </>
            )}
          </>
        }
        actions={start.graphName && <StartRunDialog projectId={project.id} graphs={start.graphs} graphName={start.graphName} label="New run" size="default" />}
      />
      {project.planProjectNumber !== null && !project.isDemo && (
        <SchedulerLine
          project={{ id: project.id, name: project.name }}
          card={scheduler}
          form={{ graphs: start.graphs, defaultGraph: start.graphName, planNumber: project.planProjectNumber, priority: plan?.priorityOptions !== undefined }}
        />
      )}
      <ProjectOverview project={{ id: project.id, name: project.name, repo }} overview={overview} start={start} />
    </main>
  );
}
