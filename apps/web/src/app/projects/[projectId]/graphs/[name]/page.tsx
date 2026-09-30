import { notFound } from "next/navigation";
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
  return (
    <GraphEditor
      projectId={projectId}
      graphName={name}
      version={graph.version}
      document={graph.document}
      library={library}
      versions={versions.map((v) => ({ version: v.version, createdAt: v.createdAt.toISOString(), createdBy: v.createdBy }))}
      runSlot={<StartRunDialog key="start-run" projectId={projectId} graphName={name} />}
    />
  );
}
