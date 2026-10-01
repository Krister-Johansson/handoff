import { notFound } from "next/navigation";
import { eq, projects } from "@handoff/db";
import { PageTrail } from "@/components/page-header";
import { graphCrumb, projectCrumbs } from "@/server/crumbs";
import { GraphEditor } from "@/components/graph-editor/graph-editor";
import { StartRunDialog } from "@/components/projects/forms";
import { getDb } from "@/lib/db";
import { getGraphForEdit, listGraphVersions } from "@/server/graphs";
import { libraryChoices } from "@/server/library-choices";

export const dynamic = "force-dynamic";

export default async function GraphEditorPage({ params }: { params: Promise<{ projectId: string; name: string }> }) {
  const { projectId, name } = await params;
  const db = getDb();
  const [graph, library, versions] = await Promise.all([getGraphForEdit(db, projectId, name), libraryChoices(db), listGraphVersions(db, projectId, name)]);
  if (!graph) notFound();
  const [project] = await db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.id, projectId));
  const crumbs = [...(await projectCrumbs(db, project!)), { label: "Graphs", href: `/projects/${projectId}?tab=settings` }, await graphCrumb(db, projectId, name)];
  return (
    <div className="flex h-[calc(100svh-3.5rem)] flex-col">
      <div className="border-b px-4 py-2">
        <PageTrail crumbs={crumbs} />
      </div>
      <div className="min-h-0 flex-1">
        <GraphEditor
          projectId={projectId}
          graphName={name}
          version={graph.version}
          document={graph.document}
          library={library}
          versions={versions.map((v) => ({ version: v.version, createdAt: v.createdAt.toISOString(), createdBy: v.createdBy }))}
          runSlot={<StartRunDialog key="start-run" projectId={projectId} graphName={name} />}
        />
      </div>
    </div>
  );
}
