import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { appendEvents, createNotification, eq, events, graphs, nodeExecutions, notifications, planPins, projects, projectSchedulers, questions, runs, schedulerEvents, sql } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs.ts";
import { planModeOf } from "./plan-mode.ts";
import { deleteProject, moveProjectRepo, projectAttention, projectsForSettings, unlinkPlan, updateProject } from "./project-admin.ts";

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

  test("saves the teardown command and the agent notes, and clears them when empty", async () => {
    const { project } = await projectWithRun();
    const notes = "The database container is shared and already running.";
    await updateProject(db, project.id, { name: "sandbox", defaultBranch: "main", teardownCommand: " dropdb --if-exists app_test_$HANDOFF_RUN_SHORT ", agentNotes: notes });
    const read = async () => (await db.select().from(projects).where(eq(projects.id, project.id)))[0];
    expect(await read()).toMatchObject({ teardownCommand: "dropdb --if-exists app_test_$HANDOFF_RUN_SHORT", agentNotes: notes });
    expect((await projectsForSettings(db, undefined))[0]).toMatchObject({ teardownCommand: "dropdb --if-exists app_test_$HANDOFF_RUN_SHORT", agentNotes: notes });
    await updateProject(db, project.id, { name: "sandbox", defaultBranch: "main", teardownCommand: "", agentNotes: "  " });
    expect(await read()).toMatchObject({ teardownCommand: null, agentNotes: null });
    await expect(updateProject(db, project.id, { name: "sandbox", defaultBranch: "main", agentNotes: "x".repeat(4_001) })).rejects.toThrow(/4000/);
  });

  test("saves the demo seed command and the UI paths, one glob a line, and clears them when empty", async () => {
    const { project } = await projectWithRun();
    await updateProject(db, project.id, { name: "sandbox", defaultBranch: "main", demoSeedCommand: " pnpm db:seed ", uiPaths: "apps/web/**\n\n  packages/ui/** \n" });
    const read = async () => (await db.select().from(projects).where(eq(projects.id, project.id)))[0];
    expect(await read()).toMatchObject({ demoSeedCommand: "pnpm db:seed", uiPaths: ["apps/web/**", "packages/ui/**"] });
    expect((await projectsForSettings(db, undefined))[0]).toMatchObject({ demoSeedCommand: "pnpm db:seed", uiPaths: ["apps/web/**", "packages/ui/**"] });
    // No UI paths means the defaults.
    await updateProject(db, project.id, { name: "sandbox", defaultBranch: "main", demoSeedCommand: "", uiPaths: " \n" });
    expect(await read()).toMatchObject({ demoSeedCommand: null, uiPaths: null });
  });

  test("refuses an invalid or taken name", async () => {
    const { project } = await projectWithRun();
    await createProject(db, { name: "other", repo: "octo/other", defaultBranch: "main" });
    await expect(updateProject(db, project.id, { name: "Bad Name", defaultBranch: "main" })).rejects.toThrow(/lowercase/);
    await expect(updateProject(db, project.id, { name: "other", defaultBranch: "main" })).rejects.toThrow(/already/);
    await expect(updateProject(db, project.id, { name: "sandbox", defaultBranch: " " })).rejects.toThrow(/branch/);
  });
});

describe("plan mode", () => {
  test("a project added after the migration plans in Flow mode, and the check refuses another mode", async () => {
    const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
    expect(await planModeOf(db, project.id)).toBe("flow");
    const refused = await db.execute(sql`update projects set plan_mode = 'gantt' where id = ${project.id}`).catch((error: Error) => error);
    expect(refused).toBeInstanceOf(Error);
    expect(String((refused as Error & { cause?: unknown }).cause ?? refused)).toMatch(/projects_plan_mode_check/);
    expect(await planModeOf(db, project.id)).toBe("flow");
  });
});

describe("Settings, Projects", () => {
  async function planned() {
    const plan = new FakeProjects(new FakeGitHub());
    const { project } = await projectWithRun();
    const { number } = await plan.createProject("octo", { owner: "octo", name: "sample" }, "sandbox plan");
    await db.update(projects).set({ planProjectNumber: number, setupCommand: "pnpm install", planMode: "timeline" }).where(eq(projects.id, project.id));
    await createProject(db, { name: "quiet", repo: "octo/quiet", defaultBranch: "trunk" });
    return { plan, project, number };
  }

  test("lists every project with its run count, setup command and the plan's GitHub Project read from GitHub", async () => {
    const { plan, project, number } = await planned();
    const rows = await projectsForSettings(db, plan);
    expect(rows).toEqual([
      expect.objectContaining({ name: "quiet", repoOwner: "octo", repoName: "quiet", defaultBranch: "trunk", setupCommand: null, planMode: "flow", runCount: 0, plan: null }),
      expect.objectContaining({ id: project.id, name: "sandbox", setupCommand: "pnpm install", planMode: "timeline", runCount: 1, plan: {
          number,
          title: "sandbox plan",
          url: expect.stringContaining(`/projects/${number}`),
          fields: { start: true, target: true, size: false, estimate: false },
        },
      }),
    ]);
  });

  test("the plan's GitHub Project lists which of Start, Target, Size and Estimate it has", async () => {
    const { plan, number } = await planned();
    const fieldsOf = async () => (await projectsForSettings(db, plan)).find((p) => p.name === "sandbox")?.plan?.fields;
    await plan.ensureEstimateFields("octo", number);
    expect(await fieldsOf()).toEqual({ start: true, target: true, size: true, estimate: true });
    // A Size field without all of S, M and L counts as missing, as Add the fields would complete it.
    const project = plan.plans.get("octo/sample")!.project;
    project.estimateFields!.size!.options.L = undefined;
    project.dateFields = { start: undefined, target: "field-target" };
    expect(await fieldsOf()).toEqual({ start: false, target: true, size: false, estimate: true });
  });

  test("keeps the plan's number when GitHub cannot be read", async () => {
    const { plan, number } = await planned();
    plan.scopesAnswer = { project: false, classic: true };
    expect((await projectsForSettings(db, plan)).find((p) => p.name === "sandbox")?.plan).toEqual({ number });
    expect((await projectsForSettings(db, undefined)).find((p) => p.name === "sandbox")?.plan).toEqual({ number });
  });

  test("unlinkPlan forgets the plan's GitHub Project and leaves the Project on GitHub", async () => {
    const { plan, project, number } = await planned();
    await unlinkPlan(db, project.id);
    const [row] = await db.select().from(projects).where(eq(projects.id, project.id));
    expect(row?.planProjectNumber).toBeNull();
    expect(await plan.getProject("octo", number)).toBeDefined();
  });
});

describe("moveProjectRepo", () => {
  /**
   * A project of octo/sample (GitHub's id 42) with a finished run on issue #11, a pin, its scheduler on and
   * its plan on octo's GitHub Project #3, as it stands after GitHub moved the repository to acme.
   */
  async function movedProject() {
    const { project, run } = await projectWithRun();
    await db.update(projects).set({ repoId: 42, planProjectNumber: 3 }).where(eq(projects.id, project.id));
    await db
      .update(runs)
      .set({ status: "succeeded", issues: [{ number: 11, title: "Add a CHANGELOG.md", url: "https://github.com/octo/sample/issues/11" }] })
      .where(eq(runs.id, run.id));
    await db.insert(planPins).values({ projectId: project.id, issue: 11, pinnedBy: "person", reason: "drop" });
    await db.insert(projectSchedulers).values({ projectId: project.id, enabled: true, graphName: "g" });
    const github = new FakeGitHub();
    github.repoId = 42;
    return { project, run, github };
  }

  test("moving a project to its repository's new owner keeps runs, graphs, pins and the scheduler row, rewrites the runs' issue URLs and forgets the plan's Project number", async () => {
    const { project, run, github } = await movedProject();
    const { project: other } = await projectWithRun("other", "octo/other");

    const moved = await moveProjectRepo({ db, github }, project.id, "acme/sample");

    expect(moved).toMatchObject({ repo: "acme/sample", from: "octo/sample", plan: { owner: "octo", number: 3 }, planUnlinked: true });
    const [row] = await db.select().from(projects).where(eq(projects.id, project.id));
    expect(row).toMatchObject({ name: "sandbox", repoOwner: "acme", repoName: "sample", repoId: 42, planProjectNumber: null });
    const [kept] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(kept?.issues).toEqual([{ number: 11, title: "Add a CHANGELOG.md", url: "https://github.com/acme/sample/issues/11" }]);
    expect((await db.select().from(graphs).where(eq(graphs.projectId, project.id))).map((g) => g.name)).toEqual(["g"]);
    expect(await db.select({ issue: planPins.issue }).from(planPins).where(eq(planPins.projectId, project.id))).toEqual([{ issue: 11 }]);
    expect(await db.select({ enabled: projectSchedulers.enabled }).from(projectSchedulers).where(eq(projectSchedulers.projectId, project.id))).toEqual([{ enabled: true }]);
    // Another project of the old owner is not touched.
    expect((await db.select().from(projects).where(eq(projects.id, other.id)))[0]).toMatchObject({ repoOwner: "octo", repoName: "other" });
  });

  test("moving pauses the scheduler with the reason", async () => {
    const { project, github } = await movedProject();

    expect(await moveProjectRepo({ db, github }, project.id, "acme/sample")).toMatchObject({ schedulerPaused: true });

    const reason = "The repository moved to acme. Set up the plan again, then resume.";
    const [scheduler] = await db.select().from(projectSchedulers).where(eq(projectSchedulers.projectId, project.id));
    expect(scheduler).toMatchObject({ enabled: true, pausedBy: "person", pauseReason: reason });
    expect(scheduler?.pausedAt).toBeInstanceOf(Date);
    const recorded = await db.select({ type: schedulerEvents.type, payload: schedulerEvents.payload }).from(schedulerEvents).where(eq(schedulerEvents.projectId, project.id));
    expect(recorded).toEqual([{ type: "scheduler.paused", payload: { by: "person", reason } }]);
  });

  test("moving refuses while a run is active", async () => {
    const { project, run, github } = await movedProject();
    await db.update(runs).set({ status: "running" }).where(eq(runs.id, run.id));

    await expect(moveProjectRepo({ db, github }, project.id, "acme/sample")).rejects.toThrow("The project has 1 active run. Let it finish or cancel it, then move the repository.");
    expect((await db.select().from(projects).where(eq(projects.id, project.id)))[0]).toMatchObject({ repoOwner: "octo", planProjectNumber: 3 });
  });

  test("moving refuses a repository with another id", async () => {
    const { project, github } = await movedProject();
    github.repoId = 43;

    await expect(moveProjectRepo({ db, github }, project.id, "acme/sample")).rejects.toThrow("acme/sample is another repository than the one this project was added with.");
    expect((await db.select().from(projects).where(eq(projects.id, project.id)))[0]).toMatchObject({ repoOwner: "octo", repoName: "sample", planProjectNumber: 3 });
    expect((await db.select().from(projectSchedulers).where(eq(projectSchedulers.projectId, project.id)))[0]?.pausedAt).toBeNull();
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
