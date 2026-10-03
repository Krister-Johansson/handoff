import { notFound } from "next/navigation";
import { eq, projects } from "@handoff/db";
import { CollapseSidebar } from "@/components/graph-editor/collapse-sidebar";
import { TopBarCrumbs } from "@/components/top-bar";
import { graphCrumb, projectCrumb } from "@/server/crumbs";
import { GraphEditor } from "@/components/graph-editor/graph-editor";
import { StartRunDialog } from "@/components/projects/forms";
import { getDb } from "@/lib/db";
import { projectSettingsPath } from "@/lib/settings-tab";
import { getGraphForEdit, listGraphVersions } from "@/server/graphs";
import { libraryChoices } from "@/server/library-choices";

export const dynamic = "force-dynamic";

/** The version in `?version=`, as a run's link to its pinned graph gives it; undefined for none or a malformed one. */
function versionOf(value: string | string[] | undefined): number | undefined {
  const version = typeof value === "string" && /^[1-9]\d*$/.test(value) ? Number(value) : undefined;
  return version !== undefined && Number.isSafeInteger(version) ? version : undefined;
}

export default async function GraphEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; name: string }>;
  searchParams: Promise<{ version?: string | string[] }>;
}) {
  const [{ projectId, name }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  // A run's graph link opens the version the run is pinned to; without one the editor opens the latest.
  const [graph, library, versions] = await Promise.all([getGraphForEdit(db, projectId, name, versionOf(query.version)), libraryChoices(db), listGraphVersions(db, projectId, name)]);
  if (!graph) notFound();
  const [project] = await db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.id, projectId));
  // The graphs are listed in project settings; the editor keeps its own full page.
  const crumbs = [
    projectCrumb(project!),
    { label: "Project settings", href: projectSettingsPath(projectId) },
    { label: "Graphs", href: projectSettingsPath(projectId, "graphs") },
    await graphCrumb(db, projectId, name),
  ];
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
