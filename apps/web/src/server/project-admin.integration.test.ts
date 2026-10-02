import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { appendEvents, createNotification, eq, events, graphs, nodeExecutions, notifications, projects, questions, runs } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs.ts";
import { deleteProject, projectAttention, updateProject } from "./project-admin.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

async function projectWithRun(name = "sandbox", repo = "octo/sample") {
  const project = await createProject(db, { name, repo, defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Add a CHANGELOG.md" });
  return { project, run };
}

describe("updateProject", () => {
  test("renames a project and changes its default branch", async () => {
    const { project } = await projectWithRun();
    await updateProject(db, project.id, { name: "renamed", defaultBranch: "trunk" });
    const [row] = await db.select().from(projects).where(eq(projects.id, project.id));
    expect(row).toMatchObject({ name: "renamed", defaultBranch: "trunk" });
  });

  test("refuses an invalid or taken name", async () => {
    const { project } = await projectWithRun();
    await createProject(db, { name: "other", repo: "octo/other", defaultBranch: "main" });
    await expect(updateProject(db, project.id, { name: "Bad Name", defaultBranch: "main" })).rejects.toThrow(/lowercase/);
    await expect(updateProject(db, project.id, { name: "other", defaultBranch: "main" })).rejects.toThrow(/already/);
    await expect(updateProject(db, project.id, { name: "sandbox", defaultBranch: " " })).rejects.toThrow(/branch/);
  });
});

describe("deleteProject", () => {
  test("refuses while the project has an active run", async () => {
    const { project } = await projectWithRun();
    await expect(deleteProject(db, project.id)).rejects.toThrow(/active/);
  });

  test("removes the project with its graphs, runs, executions, questions, events and notifications", async () => {
    const { project, run } = await projectWithRun();
    const { project: kept } = await projectWithRun("kept", "octo/kept");
    await createNotification(db, { tone: "danger", title: "sandbox: run failed", body: "Add a CHANGELOG.md", projectId: project.id, runId: run.id });
    const other = await createNotification(db, { tone: "neutral", title: "kept: run started", body: "Add a CHANGELOG.md", projectId: kept.id });
    const execution = await seedExecution(db, run.id, { status: "failed" });
    await db.insert(questions).values({ runId: run.id, nodeExecutionId: execution.id, question: "Which?" });
    await db.transaction((tx) => appendEvents(tx, run.id, [{ type: "node.failed", payload: {}, nodeExecutionId: execution.id }]));
    await db.update(runs).set({ status: "failed" }).where(eq(runs.id, run.id));

    await deleteProject(db, project.id);
    expect((await db.select().from(projects)).map((p) => p.id)).toEqual([kept.id]);
    expect(await db.select().from(graphs).where(eq(graphs.projectId, project.id))).toEqual([]);
    expect(await db.select().from(runs).where(eq(runs.id, run.id))).toEqual([]);
    expect(await db.select().from(nodeExecutions).where(eq(nodeExecutions.runId, run.id))).toEqual([]);
    expect(await db.select().from(events).where(eq(events.runId, run.id))).toEqual([]);
    expect(await db.select().from(questions)).toEqual([]);
    expect((await db.select().from(notifications)).map((n) => n.id)).toEqual([other.id]);
  });
});

describe("projectAttention", () => {
  test("counts open questions, failed runs, pull requests waiting for a review and quieter activity per project", async () => {
    const { project, run: asking } = await projectWithRun();
    const gate = await seedExecution(db, asking.id, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
    await db.insert(questions).values({ runId: asking.id, nodeExecutionId: gate.id, question: "Which license?" });
    await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, asking.id));

    const failed = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "t" });
    await seedExecution(db, failed.id, { status: "failed" });
    await db.update(runs).set({ status: "failed" }).where(eq(runs.id, failed.id));

    const review = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "t" });
    const prReady = await seedExecution(db, review.id, { nodeKey: "pr", nodeType: "pr", executorKind: "github", status: "waiting", waitKind: "github_pr" });
    await db.transaction((tx) =>
      appendEvents(tx, review.id, [
        { type: "github.pr", payload: { number: 7, ci: "pending", review: "none" }, nodeExecutionId: prReady.id },
        { type: "github.pr", payload: { number: 7, ci: "success", review: "none" }, nodeExecutionId: prReady.id },
      ]),
    );
    await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, review.id));

    const ci = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "t" });
    const prPending = await seedExecution(db, ci.id, { nodeKey: "pr", nodeType: "pr", executorKind: "github", status: "waiting", waitKind: "github_pr" });
    await db.transaction((tx) => appendEvents(tx, ci.id, [{ type: "github.pr", payload: { number: 8, ci: "pending", review: "none" }, nodeExecutionId: prPending.id }]));
    await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, ci.id));

    await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "t" });

    const { project: quiet } = await projectWithRun("quiet", "octo/quiet");
    const attention = await projectAttention(db);
    expect(attention[project.id]).toEqual({ questions: 1, failed: 1, reviews: 1, waitingOnCi: 1, running: 1 });
    expect(attention[quiet.id]).toEqual({ questions: 0, failed: 0, reviews: 0, waitingOnCi: 0, running: 1 });
  });
});
