import { asc, desc, eq, projects, runs, sql, type Db } from "@handoff/db";
import type { GitHubPort, IssueSummary, PlanItem, ProjectsPort } from "@handoff/github";
import { lastProject } from "../lib/last-project.ts";
import type { SearchChat, SearchProject, SearchRecords, SearchRun, SearchTask, SearchTasks, TaskSource } from "../lib/search/types.ts";
import { listChats } from "./assistant/conversations.ts";

/** How long a project's tasks from GitHub serve search before the next open reads GitHub again. */
export const TASKS_MAX_AGE_MS = 60_000;
/** The latest runs of each project search knows. */
const RUNS_PER_PROJECT = 200;
/** The most recently used chats search knows, besides every pinned one. */
const CHATS = 200;

type ProjectRow = typeof projects.$inferSelect;
/** Which project search covers: the one given, else the one used last, else the first. */
export type SearchScope = { projectId?: string | undefined; lastProjectId?: string | undefined };

/** Every project, the one search covers first and the others by name, with the one search covers. */
async function scopeOf(db: Db, scope: SearchScope): Promise<{ rows: ProjectRow[]; current: ProjectRow | undefined }> {
  const all = await db.select().from(projects).orderBy(asc(projects.name));
  const current = all.find((p) => p.id === scope.projectId) ?? lastProject(all, scope.lastProjectId);
  return { rows: current ? [current, ...all.filter((p) => p !== current)] : all, current };
}

const repoOf = (p: ProjectRow) => `${p.repoOwner}/${p.repoName}`;
const firstLine = (text: string) => text.trim().split("\n")[0]?.trim() ?? "";

/**
 * What search shows at once from Postgres: every project, the latest 200 runs of each project and the
 * chats, every pinned one and the 200 used last. A Flow project shows no dates, so its runs and chats carry no time.
 */
export async function searchRecords(db: Db, scope: SearchScope): Promise<SearchRecords> {
  const { rows, current } = await scopeOf(db, scope);
  const flow = new Set(rows.filter((p) => p.planMode === "flow").map((p) => p.id));
  const ranked = db
    .select({
      id: runs.id,
      projectId: runs.projectId,
      task: runs.task,
      issues: runs.issues,
      status: runs.status,
      branchName: runs.branchName,
      prNumber: runs.prNumber,
      createdAt: runs.createdAt,
      rank: sql<number>`row_number() over (partition by ${runs.projectId} order by ${runs.createdAt} desc)`.as("rank"),
    })
    .from(runs)
    .as("ranked");
  const [runRows, { conversations }] = await Promise.all([
    db.select().from(ranked).where(sql`${ranked.rank} <= ${RUNS_PER_PROJECT}`).orderBy(desc(ranked.createdAt)),
    listChats(db, { limit: CHATS }),
  ]);
  const projectList: SearchProject[] = rows.map((p) => ({ id: p.id, name: p.name, repo: repoOf(p), planMode: p.planMode, current: p === current }));
  const runList: SearchRun[] = runRows.map((r) => ({
    id: r.id,
    shortId: r.id.slice(0, 8),
    projectId: r.projectId,
    title: r.issues[0]?.title || firstLine(r.task) || r.branchName,
    issues: r.issues.map((i) => i.number),
    status: r.status,
    branch: r.branchName,
    prNumber: r.prNumber,
    at: flow.has(r.projectId) ? null : r.createdAt.toISOString(),
  }));
  const chats: SearchChat[] = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    projectId: c.project?.id ?? null,
    pinned: c.pinnedAt !== null,
    at: c.project && flow.has(c.project.id) ? null : c.updatedAt.toISOString(),
  }));
  return { projectId: current?.id ?? null, projects: projectList, runs: runList, chats };
}

const cache = new WeakMap<object, Map<string, { at: number; value: Promise<unknown> }>>();

/** A read of GitHub through `port`, kept per key for `maxAgeMs` as cachedRepos does; a failed read is not kept. */
function cached<T>(port: object, key: string, maxAgeMs: number, read: () => Promise<T>): Promise<T> {
  let entries = cache.get(port);
  if (!entries) cache.set(port, (entries = new Map()));
  const hit = entries.get(key);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.value as Promise<T>;
  const value = read();
  entries.set(key, { at: Date.now(), value });
  value.catch(() => {
    if (entries.get(key)?.value === value) entries.delete(key);
  });
  return value;
}

/** Plan items as search lists them, by number, a closed one in Done whatever its Status says. */
function planTasks(projectId: string, items: PlanItem[]): SearchTask[] {
  const byNumber = new Map(items.map((i) => [i.number, i]));
  return [...items]
    .sort((a, b) => a.number - b.number)
    .map((item) => {
      const parent = item.parent === undefined ? undefined : byNumber.get(item.parent);
      const status = item.state === "closed" ? "Done" : item.status;
      return {
        projectId,
        number: item.number,
        title: item.title,
        ...(item.kind ? { kind: item.kind } : {}),
        ...(status ? { status } : {}),
        state: item.state,
        ...(parent ? { parent: { number: parent.number, title: parent.title, ...(parent.kind ? { kind: parent.kind } : {}) } } : {}),
      };
    });
}

const issueTasks = (projectId: string, issues: IssueSummary[]): SearchTask[] =>
  [...issues].sort((a, b) => a.number - b.number).map((i) => ({ projectId, number: i.number, title: i.title }));

/** The issues the project's runs linked, each with the latest run that linked it: what Postgres knows of the tasks. */
async function runTasks(db: Db, projectId: string): Promise<SearchTask[]> {
  const rows = await db.select({ id: runs.id, issues: runs.issues }).from(runs).where(eq(runs.projectId, projectId)).orderBy(desc(runs.createdAt));
  const tasks = new Map<number, SearchTask>();
  for (const run of rows) {
    for (const issue of run.issues) {
      if (!tasks.has(issue.number)) tasks.set(issue.number, { projectId, number: issue.number, title: issue.title, fromRun: run.id.slice(0, 8) });
    }
  }
  return [...tasks.values()].sort((a, b) => a.number - b.number);
}

/**
 * One project's tasks: the plan's items when it has a plan, else its open issues, read from GitHub at
 * most once per `maxAgeMs`. When GitHub fails, the issues its runs linked, with what GitHub said.
 */
async function tasksOf(
  db: Db,
  github: GitHubPort | undefined,
  plan: ProjectsPort | undefined,
  project: ProjectRow,
  maxAgeMs: number,
): Promise<{ source: TaskSource; tasks: SearchTask[] }> {
  const base = { projectId: project.id, repo: repoOf(project) };
  const repo = { owner: project.repoOwner, name: project.repoName };
  try {
    const number = project.planProjectNumber;
    if (number !== null && plan) {
      const items = await cached(plan, `${project.id}:plan:${number}`, maxAgeMs, () => plan.listItems(repo.owner, number, repo));
      return { source: { ...base, source: "plan" }, tasks: planTasks(project.id, items) };
    }
    if (github) {
      const issues = await cached(github, `${project.id}:issues`, maxAgeMs, () => github.listIssues(repo));
      return { source: { ...base, source: "issues" }, tasks: issueTasks(project.id, issues) };
    }
    throw new Error("No GitHub credential is set.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { source: { ...base, source: "runs", error: message }, tasks: await runTasks(db, project.id) };
  }
}

/**
 * The tasks search finds: the project's, or every project's with `all`. Each project's come from GitHub
 * through a cache with a 60 second life, so opening search twice in a minute reads GitHub once.
 */
export async function searchTasks(
  db: Db,
  github: GitHubPort | undefined,
  plan: ProjectsPort | undefined,
  opts: SearchScope & { all?: boolean; maxAgeMs?: number },
): Promise<SearchTasks> {
  const { rows, current } = await scopeOf(db, opts);
  const wanted = opts.all ? rows : current ? [current] : [];
  const found = await Promise.all(wanted.map((p) => tasksOf(db, github, plan, p, opts.maxAgeMs ?? TASKS_MAX_AGE_MS)));
  return { tasks: found.flatMap((f) => f.tasks), sources: found.map((f) => f.source) };
}
