import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import loop from "@handoff/core/fixtures/loop.graph.json" with { type: "json" };
import { compileGraph, type CompileError } from "@handoff/core";
import { and, desc, eq, graphs, graphVersions, projects, runs, sql, type Db } from "@handoff/db";
import { createRun } from "@handoff/engine/runs";
import type { GitHubPort } from "@handoff/github";

export const TEMPLATES = {
  linear: { label: "Plan, code, PR, merge", document: linear },
  loop: { label: "Plan, code, test, review, PR, merge with retry loops", document: loop },
  empty: { label: "Empty", document: { attributes: { startNode: "" }, nodes: [], edges: [] } },
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

/** Adds a project; with a GitHub client it also checks the repository exists and stores its id. */
export async function createProject(db: Db, input: { name: string; repo: string; defaultBranch: string }, github?: GitHubPort) {
  const [owner, name, extra] = input.repo.trim().split("/");
  if (!owner || !name || extra !== undefined) throw new Error("Repository must look like owner/name.");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(input.name)) throw new Error("Project name: lowercase letters, digits and dashes.");
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
    .values({ name: input.name, repoOwner: owner, repoName: name, defaultBranch: input.defaultBranch || "main", repoId })
    .returning();
  return project!;
}

export async function getProjectDetail(db: Db, projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return undefined;
  const [graphRows, runRows] = await Promise.all([
    db.select().from(graphs).where(eq(graphs.projectId, projectId)).orderBy(graphs.name),
    db.select().from(runs).where(eq(runs.projectId, projectId)).orderBy(desc(runs.createdAt)).limit(50),
  ]);
  return { project, graphs: graphRows, runs: runRows };
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

export async function startRunFromGraph(db: Db, input: { projectId: string; graphName: string; task: string }) {
  const latest = await getGraphForEdit(db, input.projectId, input.graphName);
  if (!latest) throw new Error(`no graph named ${input.graphName}`);
  return createRun(db, { projectId: input.projectId, graphVersionId: latest.versionId, task: input.task });
}
