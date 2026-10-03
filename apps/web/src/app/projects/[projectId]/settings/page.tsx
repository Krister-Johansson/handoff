import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { DefaultLibrary } from "@/components/projects/default-library";
import { NewGraphDialog } from "@/components/projects/forms";
import { GraphList } from "@/components/projects/graph-list";
import { PlanModeSettings } from "@/components/projects/plan-mode-settings";
import { CARD_BODY, SectionCard } from "@/components/section-card";
import { SchedulerSettings } from "@/components/scheduler/scheduler-settings";
import { EstimateSettings } from "@/components/settings/estimate-settings";
import { ProjectSettingsNav } from "@/components/settings/settings-nav";
import { getDb } from "@/lib/db";
import { getProjects } from "@/lib/github";
import { PROJECTS_SETTINGS_PATH } from "@/lib/paths";
import { parseProjectSettingsTab, projectSettingsPath, projectSettingsTabLabel, type ProjectSettingsTab } from "@/lib/settings-tab";
import { cn } from "@/lib/utils";
import { forecastsForSettings } from "@/server/forecasts";
import { listProjectGraphs, TEMPLATES } from "@/server/graphs";
import { libraryChoices } from "@/server/library-choices";
import { projectPage, sectionCrumbs, type ProjectDetail } from "@/server/project-page";
import { loadSchedulerCard } from "@/server/scheduler-card";

export const dynamic = "force-dynamic";

const LINK = "font-medium text-foreground underline underline-offset-3";

const TEMPLATE_CHOICES = Object.entries(TEMPLATES).map(([value, t]) => ({ value, label: t.label }));

/** Whether the project's GitHub Project has a Priority field to order by; no when GitHub cannot say. */
async function hasPriority(owner: string, number: number | null) {
  if (number === null) return false;
  const plan = await getProjects()
    ?.getProject(owner, number)
    .catch(() => undefined);
  return plan?.priorityOptions !== undefined;
}

/** The open section with what it reads on the server; only the open section reads anything. */
async function openSection({ tab, detail }: { tab: ProjectSettingsTab; detail: ProjectDetail }) {
  const { project, defaultGraph } = detail;
  switch (tab) {
    case "graphs":
      return (
        <SectionCard
          title="Graphs"
          description="Each save is a new version. Runs keep the version they started with. New runs use the default graph unless you pick another."
          action={<NewGraphDialog projectId={project.id} templates={TEMPLATE_CHOICES} />}
        >
          <GraphList projectId={project.id} graphs={await listProjectGraphs(getDb(), project.id)} defaultGraph={defaultGraph} />
        </SectionCard>
      );
    case "library":
      return <DefaultLibrary key={JSON.stringify(project.library)} projectId={project.id} available={await libraryChoices(getDb())} initial={project.library} />;
    case "mode":
      // A save gives the section its stored mode again.
      return <PlanModeSettings key={project.planMode} projectId={project.id} initial={project.planMode} />;
    case "scheduler": {
      if (project.isDemo) {
        return (
          <SectionCard title="Scheduler">
            <p className={cn(CARD_BODY, "text-[13px] text-muted-foreground")}>The demo project has no scheduler.</p>
          </SectionCard>
        );
      }
      const [scheduler, priority] = await Promise.all([loadSchedulerCard(getDb(), project.id), hasPriority(project.repoOwner, project.planProjectNumber)]);
      return (
        <SchedulerSettings
          // A save or a change elsewhere gives the section its stored settings again.
          key={JSON.stringify([scheduler.status.state, scheduler.status.settings])}
          project={{ id: project.id, name: project.name, repo: `${project.repoOwner}/${project.repoName}` }}
          card={scheduler}
          form={{ graphs: detail.graphs.map((g) => g.name), defaultGraph, planNumber: project.planProjectNumber, priority }}
        />
      );
    }
    case "estimates": {
      // A Flow project has no hours, so its section is the plan budget alone and reads no forecasts.
      if (project.planMode === "flow") {
        return <EstimateSettings key={JSON.stringify(project.planBudget)} mode="flow" projectId={project.id} planBudget={project.planBudget} />;
      }
      const { capacity, forecasts } = await forecastsForSettings(getDb(), project.id, getProjects());
      return (
        <EstimateSettings
          // A save gives the section its stored values again.
          key={JSON.stringify([capacity, project.planBudget])}
          mode="timeline"
          projectId={project.id}
          capacity={capacity}
          forecasts={forecasts}
          planBudget={project.planBudget}
        />
      );
    }
  }
}

/**
 * What a project's runs start from and how its plan is worked, one section at a time beside a side menu
 * as in Settings: Graphs and the Default library, then Plan mode, the Scheduler and Estimates (Plan budget in a
 * Flow project). The repository, branch, setup
 * command and GitHub Project are managed in Settings, Projects.
 */
export default async function ProjectSettingsPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const tab = parseProjectSettingsTab(query);
  const detail = await projectPage(projectId);
  const { project } = detail;
  // The trail follows the section: handoff, Project settings, Graphs.
  const [projectStep] = sectionCrumbs(project, "Project settings");
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6 max-sm:px-4">
      <PageHeader
        crumbs={[projectStep!, { label: "Project settings", href: projectSettingsPath(project.id) }, { label: projectSettingsTabLabel(tab, project.planMode) }]}
        title="Project settings"
        description={
          <>
            What runs of {project.name} start from and how its plan works. The repository, default branch, setup command and GitHub Project are in{" "}
            <Link href={PROJECTS_SETTINGS_PATH} className={LINK}>
              Settings, Projects
            </Link>
            .
          </>
        }
      />
      <div className="grid items-start gap-6 max-md:gap-3.5 md:grid-cols-[200px_minmax(0,1fr)]">
        <ProjectSettingsNav projectId={project.id} mode={project.planMode} active={tab} />
        <div className="flex min-w-0 flex-col gap-4">
          {await openSection({ tab, detail })}
        </div>
      </div>
    </main>
  );
}
