import { redirect } from "next/navigation";
import { projectSettingsPath } from "@/lib/settings-tab";

/** A project's graphs are a section of its settings now; the old Graphs page lands there. The editor stays at /graphs/<name>. */
export default async function ProjectGraphsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  redirect(projectSettingsPath(projectId, "graphs"));
}
