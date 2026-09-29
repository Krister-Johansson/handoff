import { notFound } from "next/navigation";
import { listLibrary } from "@handoff/db";
import { GraphEditor } from "@/components/graph-editor/graph-editor";
import { StartRunDialog } from "@/components/projects/forms";
import { getDb } from "@/lib/db";
import { getGraphForEdit } from "@/server/graphs";

export const dynamic = "force-dynamic";

export default async function GraphEditorPage({ params }: { params: Promise<{ projectId: string; name: string }> }) {
  const { projectId, name } = await params;
  const db = getDb();
  const [graph, library] = await Promise.all([getGraphForEdit(db, projectId, name), listLibrary(db)]);
  if (!graph) notFound();
  return (
    <GraphEditor
      projectId={projectId}
      graphName={name}
      version={graph.version}
      document={graph.document}
      library={{ skills: library.skills.map((s) => s.name), mcp: library.mcp.map((m) => m.name), agents: library.agents.map((a) => a.name) }}
      runSlot={<StartRunDialog projectId={projectId} graphName={name} />}
    />
  );
}
