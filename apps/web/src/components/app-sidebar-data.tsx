import { getDb } from "@/lib/db";
import { listProjects } from "@/server/graphs";
import { inboxTotal } from "@/server/inbox-groups";
import { workerSummary } from "@/server/workers";
import { AppSidebar } from "./app-sidebar";

/**
 * The sidebar with what it shows, read per request: the projects with their active runs, the Inbox
 * count (the same count as the Inbox page) and the worker status.
 */
export async function AppSidebarData({ lastProjectId }: { lastProjectId: string | undefined }) {
  const db = getDb();
  const [projects, inboxCount, worker] = await Promise.all([
    listProjects(db).catch(() => []),
    inboxTotal(db).catch(() => 0),
    workerSummary(db).catch(() => ({ live: 0, queuedRuns: 0 })),
  ]);
  return (
    <AppSidebar
      projects={projects.map((p) => ({ id: p.id, name: p.name, repo: `${p.repoOwner}/${p.repoName}`, activeRuns: p.activeRuns }))}
      lastProjectId={lastProjectId}
      inboxCount={inboxCount}
      worker={{ live: worker.live, queuedRuns: worker.queuedRuns }}
    />
  );
}
