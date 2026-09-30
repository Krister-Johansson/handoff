import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import loop from "@handoff/core/fixtures/loop.graph.json" with { type: "json" };
import planReview from "@handoff/core/fixtures/plan-review.graph.json" with { type: "json" };
import { compileGraph, RunStateSchema, suggestProjectName, type CompileError, type LinkedIssue } from "@handoff/core";
import { and, desc, eq, graphs, graphVersions, inArray, projects, runs, sql, type Db } from "@handoff/db";
import { createRun } from "@handoff/engine/runs";
import type { GitHubPort } from "@handoff/github";

export const TEMPLATES = {
  plan: { label: "Plan, review, approve, build: a reviewer and you approve the plan before any code", document: planReview },
  linear: { label: "Plan, code, PR, merge", document: linear },
  loop: { label: "Plan, code, test, review, PR, merge with retry loops", document: loop },
  empty: {
    label: "Empty: a Start node to build from",
    document: { attributes: { startNode: "start" }, nodes: [{ key: "start", attributes: { type: "start", label: "Start", config: { trigger: "run" }, x: 0, y: 0 } }], edges: [] },
  },
} as const;
export type TemplateName = keyof typeof TEMPLATES;

export async function listProjects(db: Db) {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      repoOwner: projects.repoOwner,
      repoName: projects.repoName,
      defaultBranch: projects.defaultBranch,
      isDemo: projects.isDemo,
      runCount: sql<number>`(select count(*)::int from runs r where r.project_id = "projects"."id")`,
      activeRuns: sql<number>`(select count(*)::int from runs r where r.project_id = "projects"."id" and r.status in ('queued','running','waiting'))`,
    })
    .from(projects)
    .orderBy(projects.name);
}

/**
 * Adds a project; with a GitHub client it also checks the repository exists and stores its id.
 * Without a name the project is named after the repository (lowercase, dashes, made unique).
 */
export async function createProject(db: Db, input: { name?: string; repo: string; defaultBranch: string }, github?: GitHubPort) {
  const [owner, name, extra] = input.repo.trim().split("/");
  if (!owner || !name || extra !== undefined) throw new Error("Repository must look like owner/name.");
  const projectName = input.name?.trim() || suggestProjectName(name, (await db.select({ name: projects.name }).from(projects)).map((p) => p.name));
  if (!/^[a-z0-9][a-z0-9-]*$/.test(projectName)) throw new Error("Project name: lowercase letters, digits and dashes.");
  let repoId: number | null = null;
  if (github) {
    try {
      repoId = await github.getRepoId({ owner, name });
    } catch {
      throw new Error(`GitHub cannot find ${owner}/${name} with the configured credentials.`);
    }
  }
  const [project] = await db
    .insert(projects)
    .values({ name: projectName, repoOwner: owner, repoName: name, defaultBranch: input.defaultBranch || "main", repoId })
    .returning();
  return project!;
}

export async function getProjectDetail(db: Db, projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return undefined;
  const [graphRows, runRows, [lastUsed]] = await Promise.all([
    db.select().from(graphs).where(eq(graphs.projectId, projectId)).orderBy(graphs.name),
    db.select().from(runs).where(eq(runs.projectId, projectId)).orderBy(desc(runs.createdAt)).limit(50),
    db
      .select({ name: graphs.name })
      .from(runs)
      .innerJoin(graphVersions, eq(graphVersions.id, runs.graphVersionId))
      .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
      .where(eq(runs.projectId, projectId))
      .orderBy(desc(runs.createdAt))
      .limit(1),
  ]);
  // New runs default to the graph the latest run used; without runs, to the graph changed last.
  const lastChanged = [...graphRows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  return { project, graphs: graphRows, runs: runRows, defaultGraph: lastUsed?.name ?? lastChanged?.name };
}

export async function getGraphForEdit(db: Db, projectId: string, name: string) {
  const [row] = await db
    .select({ version: graphVersions.version, document: graphVersions.document, versionId: graphVersions.id })
    .from(graphVersions)
    .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
    .where(and(eq(graphs.projectId, projectId), eq(graphs.name, name)))
    .orderBy(desc(graphVersions.version))
    .limit(1);
  return row;
}

export async function listGraphVersions(db: Db, projectId: string, name: string) {
  return db
    .select({ version: graphVersions.version, createdAt: graphVersions.createdAt, createdBy: graphVersions.createdBy })
    .from(graphVersions)
    .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
    .where(and(eq(graphs.projectId, projectId), eq(graphs.name, name)))
    .orderBy(desc(graphVersions.version));
}

export async function getGraphVersion(db: Db, projectId: string, name: string, version: number) {
  const [row] = await db
    .select({ version: graphVersions.version, document: graphVersions.document })
    .from(graphVersions)
    .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
    .where(and(eq(graphs.projectId, projectId), eq(graphs.name, name), eq(graphVersions.version, version)));
  return row;
}

export type SaveResult = { ok: true; version: number } | { ok: false; errors: CompileError[] };

/** Validates with compileGraph and stores a new immutable version; runs stay pinned to theirs. */
export async function saveGraphVersion(db: Db, input: { projectId: string; name: string; document: unknown; createdBy?: string }): Promise<SaveResult> {
  const compiled = compileGraph(input.document);
  if (!compiled.ok) return { ok: false, errors: compiled.errors };
  const version = await db.transaction(async (tx) => {
    const [graph] = await tx
      .insert(graphs)
      .values({ projectId: input.projectId, name: input.name, latestVersion: 1 })
      .onConflictDoUpdate({ target: [graphs.projectId, graphs.name], set: { latestVersion: sql`${graphs.latestVersion} + 1` } })
      .returning();
    await tx.insert(graphVersions).values({
      graphId: graph!.id,
      version: graph!.latestVersion,
      document: compiled.graph.document as unknown as Record<string, unknown>,
      createdBy: input.createdBy ?? "dashboard",
    });
    return graph!.latestVersion;
  });
  return { ok: true, version };
}

/** New graphs start from a template; the empty template is stored without compiling so it can be edited. */
export async function createGraphFromTemplate(db: Db, projectId: string, name: string, template: TemplateName) {
  if (template !== "empty") return saveGraphVersion(db, { projectId, name, document: TEMPLATES[template].document });
  const [graph] = await db.insert(graphs).values({ projectId, name, latestVersion: 1 }).returning();
  await db.insert(graphVersions).values({ graphId: graph!.id, version: 1, document: TEMPLATES.empty.document as Record<string, unknown>, createdBy: "dashboard" });
  return { ok: true as const, version: 1 };
}

/**
 * Starts a run of a graph's latest version. Issues are read from GitHub so the agents get their
 * bodies; with issues and no task, the task is the issues' titles.
 */
export async function startRunFromGraph(
  db: Db,
  input: { projectId: string; graphName: string; task: string; issues?: number[] | LinkedIssue[] },
  github?: GitHubPort,
) {
  const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId));
  if (!project) throw new Error("project not found");
  if (project.isDemo) throw new Error("This is a demo project with simulated runs. Add a real repository to run a graph.");
  const latest = await getGraphForEdit(db, input.projectId, input.graphName);
  if (!latest) throw new Error(`no graph named ${input.graphName}`);
  const issues = await linkIssues(input.issues ?? [], { owner: project.repoOwner, name: project.repoName }, github);
  const task = input.task.trim() || issues.map((i) => `#${i.number} ${i.title}`).join("\n");
  if (!task) throw new Error("Describe the task, or link at least one issue.");
  return createRun(db, { projectId: input.projectId, graphVersionId: latest.versionId, task, issues });
}

async function linkIssues(issues: number[] | LinkedIssue[], repo: { owner: string; name: string }, github?: GitHubPort): Promise<LinkedIssue[]> {
  if (issues.length === 0) return [];
  if (typeof issues[0] !== "number") return issues as LinkedIssue[];
  if (!github) throw new Error("Linking issues needs GitHub access (GITHUB_TOKEN or a GitHub App).");
  return Promise.all(
    (issues as number[]).map(async (number) => {
      const issue = await github.getIssue(repo, number);
      return { number: issue.number, title: issue.title, url: issue.url, body: issue.body };
    }),
  );
}

/** Starts the same task again on the latest version of the graph an earlier run used. */
export async function runAgain(db: Db, runId: string) {
  const [earlier] = await db
    .select({ projectId: runs.projectId, task: runs.task, status: runs.status, state: runs.state, graphName: graphs.name })
    .from(runs)
    .innerJoin(graphVersions, eq(graphVersions.id, runs.graphVersionId))
    .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
    .where(eq(runs.id, runId));
  if (!earlier) throw new Error("run not found");
  if (earlier.status === "queued" || earlier.status === "running" || earlier.status === "waiting") {
    throw new Error(`The run is still ${earlier.status}.`);
  }
  const issues = RunStateSchema.shape.issues.parse(earlier.state.issues) ?? [];
  return startRunFromGraph(db, { projectId: earlier.projectId, graphName: earlier.graphName, task: earlier.task, issues });
}

const GRAPH_NAME = /^[a-z0-9][a-z0-9-]*$/;

export async function renameGraph(db: Db, projectId: string, from: string, to: string) {
  if (!GRAPH_NAME.test(to)) throw new Error("Graph name: lowercase letters, digits and dashes.");
  const [taken] = await db.select({ id: graphs.id }).from(graphs).where(and(eq(graphs.projectId, projectId), eq(graphs.name, to)));
  if (taken) throw new Error(`A graph named ${to} already exists.`);
  await db.update(graphs).set({ name: to }).where(and(eq(graphs.projectId, projectId), eq(graphs.name, from)));
}

/** Deletes a graph and its versions; refused while any run is pinned to one of its versions. */
export async function deleteGraph(db: Db, projectId: string, name: string) {
  await db.transaction(async (tx) => {
    const [graph] = await tx.select({ id: graphs.id }).from(graphs).where(and(eq(graphs.projectId, projectId), eq(graphs.name, name)));
    if (!graph) return;
    const versionIds = (await tx.select({ id: graphVersions.id }).from(graphVersions).where(eq(graphVersions.graphId, graph.id))).map((v) => v.id);
    if (versionIds.length) {
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(runs).where(inArray(runs.graphVersionId, versionIds));
      if (n > 0) throw new Error(`${n} run${n === 1 ? "" : "s"} used this graph, so it cannot be deleted. Rename it instead.`);
      await tx.delete(graphVersions).where(eq(graphVersions.graphId, graph.id));
    }
    await tx.delete(graphs).where(eq(graphs.id, graph.id));
  });
}
