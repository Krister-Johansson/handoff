import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { graphs, graphVersions, nodeExecutions, projects, runs, events, type Db } from "@handoff/db";
import { listEventsAfter } from "@handoff/db";
import { createRun } from "../runs.ts";
import { runOnce, type EngineDeps } from "../scheduler/worker.ts";
import type { ExecutorRegistry, WorkdirProvider } from "../types.ts";

export const caps = { cli: 1, shell: 4, github: 4, human: 100, function: 8 };

export class TempWorkdirs implements WorkdirProvider {
  readonly acquired: string[] = [];
  async acquire(spec: { runId: string }) {
    const path = mkdtempSync(join(tmpdir(), `handoff-wd-${spec.runId.slice(0, 8)}-`));
    this.acquired.push(path);
    return { path, baseSha: "0".repeat(40) };
  }
  async release() {}
}

export async function seedGraph(db: Db, document: unknown, opts: { localClonePath?: string } = {}) {
  const [project] = await db
    .insert(projects)
    .values({
      name: `p-${crypto.randomUUID().slice(0, 8)}`,
      repoOwner: "octo",
      repoName: "sample",
      defaultBranch: "main",
      localClonePath: opts.localClonePath ?? null,
    })
    .returning();
  const [graph] = await db.insert(graphs).values({ projectId: project!.id, name: "g", latestVersion: 1 }).returning();
  const [version] = await db
    .insert(graphVersions)
    .values({ graphId: graph!.id, version: 1, document: document as Record<string, unknown> })
    .returning();
  return { project: project!, graphVersion: version! };
}

export function engineDeps(db: Db, executors: ExecutorRegistry, overrides: Partial<EngineDeps> = {}): EngineDeps {
  return {
    db,
    workerId: "test-worker",
    caps,
    leaseMs: 60_000,
    executors,
    workdirs: new TempWorkdirs(),
    stagingRoot: mkdtempSync(join(tmpdir(), "handoff-staging-")),
    ...overrides,
  };
}

/** Runs the worker loop synchronously until nothing is claimable. */
export async function drain(deps: EngineDeps, maxSteps = 50) {
  for (let i = 0; i < maxSteps; i++) if (!(await runOnce(deps))) return i;
  throw new Error("drain did not settle");
}

export async function startRun(db: Db, document: unknown, task = "Add a CHANGELOG.md") {
  const { project, graphVersion } = await seedGraph(db, document);
  const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task });
  return { project, graphVersion, run };
}

export async function inspect(db: Db, runId: string) {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  const executions = await db.select().from(nodeExecutions).where(eq(nodeExecutions.runId, runId)).orderBy(nodeExecutions.createdAt);
  const log = await listEventsAfter(db, runId, 0, 10_000);
  return { run: run!, executions, events: log, types: log.map((e) => e.type) };
}

export { events };
