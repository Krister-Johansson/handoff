import { notFound } from "next/navigation";
import { eq, projects } from "@handoff/db";
import { CollapseSidebar } from "@/components/graph-editor/collapse-sidebar";
import { TopBarCrumbs } from "@/components/top-bar";
import { graphCrumb, projectCrumb } from "@/server/crumbs";
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
  const crumbs = [projectCrumb(project!), { label: "Graphs", href: `/projects/${projectId}/graphs` }, await graphCrumb(db, projectId, name)];
  return (
    // The page is the height under the top bar (52 px and its border), so the canvas fills it.
    <div className="h-[calc(100svh-53px)]">
      <TopBarCrumbs crumbs={crumbs} />
      <CollapseSidebar />
      <GraphEditor
        projectId={projectId}
        graphName={name}
        version={graph.version}
        document={graph.document}
        library={library}
        versions={versions.map((v) => ({ version: v.version, createdAt: v.createdAt.toISOString(), createdBy: v.createdBy }))}
        runSlot={<StartRunDialog key="start-run" projectId={projectId} graphName={name} label="Start run" variant="outline" />}
      />
    </div>
  );
}
