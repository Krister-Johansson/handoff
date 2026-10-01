import { and, desc, eq, graphs, projects, runs, type Db } from "@handoff/db";
import type { Crumb, CrumbMenuItem } from "../components/page-header";

const TABS = [
  { tab: "runs", label: "Runs" },
  { tab: "issues", label: "Issues" },
  { tab: "pulls", label: "Pull requests" },
  { tab: "settings", label: "Settings" },
] as const;

export type ProjectTabName = (typeof TABS)[number]["tab"];

const short = (text: string, max = 60) => {
  const line = text.split("\n")[0]!.trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** "Projects › <project>", the project crumb opening the other projects to switch to. */
export async function projectCrumbs(db: Db, project: { id: string; name: string }): Promise<Crumb[]> {
  const all = await db.select({ id: projects.id, name: projects.name }).from(projects).orderBy(projects.name);
  return [
    { label: "Projects", href: "/projects" },
    { label: project.name, href: `/projects/${project.id}`, menu: all.map((p) => ({ label: p.name, href: `/projects/${p.id}`, current: p.id === project.id })) },
  ];
}

/** A project tab's crumb, opening the project's other tabs. */
export function projectTabCrumb(projectId: string, tab: ProjectTabName): Crumb {
  const current = TABS.find((t) => t.tab === tab)!;
  return {
    label: current.label,
    href: `/projects/${projectId}?tab=${tab}`,
    menu: TABS.map((t) => ({ label: t.label, href: `/projects/${projectId}?tab=${t.tab}`, current: t.tab === tab })),
  };
}

/** A graph's crumb, opening the project's other graphs. */
export async function graphCrumb(db: Db, projectId: string, name: string): Promise<Crumb> {
  const all = await db.select({ name: graphs.name, latestVersion: graphs.latestVersion }).from(graphs).where(eq(graphs.projectId, projectId)).orderBy(graphs.name);
  return {
    label: name,
    href: `/projects/${projectId}/graphs/${encodeURIComponent(name)}`,
    menu: all.map((g) => ({ label: g.name, href: `/projects/${projectId}/graphs/${encodeURIComponent(g.name)}`, current: g.name === name, hint: `v${g.latestVersion}` })),
  };
}

/** A run's crumb, opening the project's recent runs. */
export async function runCrumb(db: Db, projectId: string, run: { id: string; task: string }): Promise<Crumb> {
  const recent = await db
    .select({ id: runs.id, task: runs.task, status: runs.status })
    .from(runs)
    .where(and(eq(runs.projectId, projectId)))
    .orderBy(desc(runs.createdAt))
    .limit(15);
  const menu: CrumbMenuItem[] = recent.map((r) => ({ label: short(r.task), href: `/runs/${r.id}`, current: r.id === run.id, hint: r.status }));
  if (!recent.some((r) => r.id === run.id)) menu.unshift({ label: short(run.task), href: `/runs/${run.id}`, current: true });
  return { label: short(run.task, 48), href: `/runs/${run.id}`, menu };
}
