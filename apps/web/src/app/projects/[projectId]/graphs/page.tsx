import { PageHeader } from "@/components/page-header";
import { NewGraphDialog } from "@/components/projects/forms";
import { GraphList } from "@/components/projects/graph-list";
import { SectionCard } from "@/components/section-card";
import { getDb } from "@/lib/db";
import { listProjectGraphs, TEMPLATES } from "@/server/graphs";
import { projectPage, sectionCrumbs } from "@/server/project-page";

export const dynamic = "force-dynamic";

const TEMPLATE_CHOICES = Object.entries(TEMPLATES).map(([value, t]) => ({ value, label: t.label }));

/** The project's graphs, with New graph to start one from a template. */
export default async function ProjectGraphsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const [{ project, defaultGraph }, graphs] = await Promise.all([projectPage(projectId), listProjectGraphs(getDb(), projectId)]);
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader
        crumbs={sectionCrumbs(project, "Graphs")}
        title="Graphs"
        description="Each save is a new version. Runs keep the version they started with."
        actions={<NewGraphDialog projectId={project.id} templates={TEMPLATE_CHOICES} />}
      />
      <SectionCard>
        <GraphList projectId={project.id} graphs={graphs} defaultGraph={defaultGraph} />
      </SectionCard>
    </main>
  );
}
