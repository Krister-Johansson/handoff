import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { DefaultLibrary } from "@/components/projects/default-library";
import { CARD_BODY, SectionCard } from "@/components/section-card";
import { SchedulerSettings } from "@/components/scheduler/scheduler-settings";
import { getDb } from "@/lib/db";
import { getProjects } from "@/lib/github";
import { PROJECTS_SETTINGS_PATH, projectPath } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { libraryChoices } from "@/server/library-choices";
import { projectPage, sectionCrumbs } from "@/server/project-page";
import { loadSchedulerCard } from "@/server/scheduler-card";

export const dynamic = "force-dynamic";

const LINK = "font-medium text-foreground underline underline-offset-3";

/** Whether the project's GitHub Project has a Priority field to order by; no when GitHub cannot say. */
async function hasPriority(owner: string, number: number | null) {
  if (number === null) return false;
  const plan = await getProjects()
    ?.getProject(owner, number)
    .catch(() => undefined);
  return plan?.priorityOptions !== undefined;
}

/**
 * What a project's runs start from: its default graph, the library every run gets and the scheduler.
 * The project's repository, branch, setup command and plan are managed in Settings, Projects.
 */
export default async function ProjectSettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const [{ project, runs, graphs, defaultGraph }, available, scheduler] = await Promise.all([projectPage(projectId), libraryChoices(getDb()), loadSchedulerCard(getDb(), projectId)]);
  const priority = await hasPriority(project.repoOwner, project.planProjectNumber);
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader
        crumbs={sectionCrumbs(project, "Project settings")}
        title="Project settings"
        description={
          <>
            What runs of {project.name} start from. The repository, default branch, setup command and plan are in{" "}
            <Link href={PROJECTS_SETTINGS_PATH} className={LINK}>
              Settings, Projects
            </Link>
            .
          </>
        }
      />
      <SectionCard
        title="Default graph"
        description={
          <>
            New runs use it unless you pick another. Make and edit graphs on{" "}
            <Link href={projectPath(project.id, "graphs")} className={LINK}>
              Graphs
            </Link>
            .
          </>
        }
      >
        <p className={cn(CARD_BODY, "text-[13px]")}>
          {defaultGraph ? (
            <>
              <Link href={`${projectPath(project.id, "graphs")}/${encodeURIComponent(defaultGraph)}`} className="font-mono text-xs underline-offset-3 hover:underline">
                {defaultGraph}
              </Link>{" "}
              <span className="text-muted-foreground">({runs.length > 0 ? "the graph the latest run used" : "the graph changed last"})</span>
            </>
          ) : (
            <span className="text-muted-foreground">No graph yet.</span>
          )}
        </p>
      </SectionCard>
      <DefaultLibrary key={JSON.stringify(project.library)} projectId={project.id} available={available} initial={project.library} />
      {!project.isDemo && (
        <SchedulerSettings
          // A save or a change elsewhere gives the section its stored settings again.
          key={JSON.stringify([scheduler.status.state, scheduler.status.settings])}
          project={{ id: project.id, name: project.name, repo: `${project.repoOwner}/${project.repoName}` }}
          card={scheduler}
          form={{ graphs: graphs.map((g) => g.name), defaultGraph, planNumber: project.planProjectNumber, priority }}
        />
      )}
    </main>
  );
}
