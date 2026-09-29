import type { Db } from "../client.ts";
import { graphs, graphVersions, nodeExecutions, projects, runs } from "../schema/index.ts";

type ExecutionOverrides = Partial<typeof nodeExecutions.$inferInsert>;

/** Minimal project, graph version and run rows for database-level tests. */
export async function seedRun(db: Db, opts: { status?: "queued" | "running" | "waiting" } = {}) {
  const [project] = await db
    .insert(projects)
    .values({ name: `p-${crypto.randomUUID()}`, repoOwner: "o", repoName: "r", defaultBranch: "main" })
    .returning();
  const [graph] = await db.insert(graphs).values({ projectId: project!.id, name: "g", latestVersion: 1 }).returning();
  const [version] = await db
    .insert(graphVersions)
    .values({ graphId: graph!.id, version: 1, document: {} })
    .returning();
  const [run] = await db
    .insert(runs)
    .values({
      projectId: project!.id,
      graphVersionId: version!.id,
      status: opts.status ?? "running",
      task: "t",
      state: { task: "t", loops: {}, nodes: {}, human: {} },
      baseBranch: "main",
      branchName: "handoff/t",
    })
    .returning();
  return { project: project!, run: run! };
}

export async function seedExecution(db: Db, runId: string, overrides: ExecutionOverrides = {}) {
  const [row] = await db
    .insert(nodeExecutions)
    .values({ runId, nodeKey: "coder", nodeType: "coder", executorKind: "cli", attempt: 1, ...overrides })
    .returning();
  return row!;
}
