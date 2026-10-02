import { PageHeader } from "@/components/page-header";
import { DefaultLibrary } from "@/components/projects/default-library";
import { ProjectSettingsActions } from "@/components/projects/project-card";
import { CARD_BODY, SectionCard } from "@/components/section-card";
import { getDb } from "@/lib/db";
import { cn } from "@/lib/utils";
import { libraryChoices } from "@/server/library-choices";
import { projectPage, sectionCrumbs } from "@/server/project-page";

export const dynamic = "force-dynamic";

/** The project's name, repository, branch, setup command and default graph, and the library every run gets. */
export default async function ProjectSettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const [{ project, runs, defaultGraph }, available] = await Promise.all([projectPage(projectId), libraryChoices(getDb())]);
  const runCount = runs.length;
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader crumbs={sectionCrumbs(project, "Project settings")} title="Project settings" />
      <SectionCard
        title="Project"
        description={
          <>
            The CLI refers to the project by its name. Runs branch off the default branch
            {project.setupCommand ? " and run the setup command in their worktree first." : "."}
          </>
        }
        action={
          <ProjectSettingsActions
            project={{
              id: project.id,
              name: project.name,
              repoOwner: project.repoOwner,
              repoName: project.repoName,
              defaultBranch: project.defaultBranch,
              isDemo: project.isDemo,
              runCount,
              setupCommand: project.setupCommand,
            }}
          />
        }
      >
        <dl className={cn(CARD_BODY, "grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]")}>
          <dt className="text-muted-foreground">Name</dt>
          <dd className="font-mono text-xs leading-5" data-voice-phrase={project.name}>
            {project.name}
          </dd>
          <dt className="text-muted-foreground">Repository</dt>
          <dd className="font-mono text-xs leading-5">
            {project.repoOwner}/{project.repoName}
          </dd>
          <dt className="text-muted-foreground">Default branch</dt>
          <dd className="font-mono text-xs leading-5">{project.defaultBranch}</dd>
          <dt className="text-muted-foreground">Setup command</dt>
          <dd className="font-mono text-xs leading-5 break-all">{project.setupCommand ?? <span className="font-sans text-[13px] text-muted-foreground">none</span>}</dd>
          <dt className="text-muted-foreground">Default graph</dt>
          <dd className="font-mono text-xs leading-5">
            {defaultGraph ? (
              <>
                {defaultGraph} <span className="font-sans text-[13px] text-muted-foreground">({runCount > 0 ? "the graph the latest run used" : "the graph changed last"})</span>
              </>
            ) : (
              <span className="font-sans text-[13px] text-muted-foreground">none</span>
            )}
          </dd>
        </dl>
      </SectionCard>
      <DefaultLibrary key={JSON.stringify(project.library)} projectId={project.id} available={available} initial={project.library} />
    </main>
  );
}
