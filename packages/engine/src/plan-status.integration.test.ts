import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { appendEvents, eq, nodeExecutions, projects, questions, runs, wakeByKey } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { ProjectsAccessError, type PlanStatus } from "@handoff/github";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { mergeNodeExecutor, prNodeExecutor } from "./executors/github.ts";
import { answerQuestion, cancelRun, resolveExhaustedLoop } from "./operations.ts";
import { createRun } from "./runs.ts";
import { startRun } from "./start-run.ts";
import { createOriginRepo, git } from "./testing/git.ts";
import { drain, engineDeps, inspect, seedGraph } from "./testing/harness.ts";
import type { ExecutorRegistry } from "./types.ts";
import { GitWorktreeProvider } from "./workdir/git-worktree.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const repo = { owner: "octo", name: "sample" };

/**
 * A project with a plan on the repository's GitHub Project. `task` adds a task in a Status, `start` starts a
 * run on Ready tasks as handoff does (they move to Running), and `runWithoutMove` creates a run that wrote
 * no Status, as a run started before its task was on the plan.
 */
async function planned() {
  const plan = new FakeProjects(new FakeGitHub());
  const { number } = await plan.createProject("octo", repo, "sample plan");
  const { project, graphVersion } = await seedGraph(db, linear);
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, project.id));
  const setStatus = (n: number, status: PlanStatus) => {
    plan.itemsOf(repo).get(n)!.status = status;
  };
  const task = async (title: string, status: PlanStatus = "Ready") => {
    const created = await plan.createIssue(repo, { project: number, title, body: "", labels: ["task"] });
    setStatus(created.number, status);
    return { number: created.number, title, url: created.url, body: "" };
  };
  type Task = Awaited<ReturnType<typeof task>>;
  const start = (issues: Task[]) => startRun(db, { projectId: project.id, graphName: "g", task: "Build it", issues }, { projects: plan });
  const runWithoutMove = (issues: Task[]) => createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Build it", issues });
  const statusOf = (n: number) => plan.getStatus(repo, number, n);
  return { plan, task, start, runWithoutMove, statusOf, setStatus };
}

const planEvents = async (runId: string) =>
  (await inspect(db, runId)).events.filter((e) => e.type.startsWith("plan.")).map((e) => [e.type, e.payload]);

test("cancelling a run that started on a Ready task puts it back to Ready", async () => {
  const { plan, task, start, statusOf } = await planned();
  const migration = await task("Add the migration");
  const cancelled = await start([migration]);
  expect(await statusOf(migration.number)).toBe("Running");
  await cancelRun(db, cancelled.id, { reason: "changed my mind", projects: plan });
  expect(await statusOf(migration.number)).toBe("Ready");
  expect(await planEvents(cancelled.id)).toEqual([
    ["plan.status", { issue: migration.number, status: "Running", from: "Ready" }],
    ["plan.status", { issue: migration.number, status: "Ready" }],
  ]);
});

test("a status write refused for SSO records plan.skipped with the sentence", async () => {
  const { plan, task, start, statusOf } = await planned();
  const migration = await task("Add the migration");
  const sentence =
    "octo uses SAML single sign-on, and GITHUB_TOKEN is not authorized for it. Authorize the token at https://github.com/orgs/octo/sso?authorization_request=A1 within the hour, or on GitHub under Settings, Developer settings, Personal access tokens, Configure SSO.";
  plan.owners.set("octo", "Organization");
  plan.setStatus = async () => {
    throw new ProjectsAccessError("sso", sentence);
  };

  const run = await start([migration]);

  expect(await planEvents(run.id)).toEqual([["plan.skipped", { issue: migration.number, status: "Running", reason: sentence }]]);
  expect(await statusOf(migration.number)).toBe("Ready");
});

test("a run writes Running, In review and Done on an organization's Project", async () => {
  const origin = createOriginRepo();
  const github = new FakeGitHub();
  const plan = new FakeProjects(github);
  // The repository's owner octo is an organization, and the plan is a Project the organization owns.
  plan.owners.set("octo", "Organization");
  const { number } = await plan.createProject("octo", repo, "sample plan");
  const { project } = await seedGraph(db, linear, { localClonePath: origin });
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, project.id));
  const created = await plan.createIssue(repo, { project: number, title: "Add the changelog", body: "", labels: ["task"] });
  plan.itemsOf(repo).get(created.number)!.status = "Ready";
  const statusOf = () => plan.getStatus(repo, number, created.number);
  const executors: ExecutorRegistry = {
    planner: { needsWorkdir: false, execute: async () => ({ kind: "completed", output: { plan: "p", steps: [], ownedPaths: ["CHANGELOG.md"] } }) },
    coder: {
      needsWorkdir: true,
      execute: async (ctx) => {
        writeFileSync(join(ctx.workdir!.path, "CHANGELOG.md"), "# Changelog\n");
        git(ctx.workdir!.path, "add", "-A");
        git(ctx.workdir!.path, "commit", "-qm", "Add changelog");
        return { kind: "completed", output: { status: "done", summary: "Added CHANGELOG.md" } };
      },
    },
    pr: prNodeExecutor({ github, projects: plan }),
    merge: mergeNodeExecutor({ github, projects: plan }),
  };
  const deps = engineDeps(db, executors, { workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }) });

  const run = await startRun(db, { projectId: project.id, graphName: "g", task: "Add a CHANGELOG.md", issues: [{ ...created, title: "Add the changelog", body: "" }] }, { projects: plan });
  expect(await statusOf()).toBe("Running");
  await drain(deps);
  expect(await statusOf()).toBe("In review");
  github.setChecks(1, "SUCCESS");
  await wakeByKey(db, "gh:pr:42:1", { reason: "webhook" });
  await drain(deps);

  expect(github.merged).toEqual([1]);
  expect(await statusOf()).toBe("Done");
  expect(plan.plans.get("octo/sample")?.project.owner).toBe("Organization");
  expect((await planEvents(run.id)).map(([type, payload]) => [type, (payload as { status: string }).status])).toEqual([
    ["plan.status", "Running"],
    ["plan.status", "In review"],
    ["plan.status", "Done"],
  ]);
});

test("cancelling a run that never moved its task leaves the task's Status alone", async () => {
  const { plan, task, runWithoutMove, statusOf } = await planned();
  const blocked = await task("Wait for the schema", "Shaping");
  const cancelled = await runWithoutMove([blocked]);
  await cancelRun(db, cancelled.id, { projects: plan });
  expect(await statusOf(blocked.number)).toBe("Shaping");
  expect(await planEvents(cancelled.id)).toEqual([]);
});

test("cancelling a run whose move to Running was skipped leaves the task's Status alone", async () => {
  const { plan, task, runWithoutMove, statusOf } = await planned();
  const migration = await task("Add the migration");
  const cancelled = await runWithoutMove([migration]);
  await db.transaction((tx) => appendEvents(tx, cancelled.id, [{ type: "plan.skipped", payload: { issue: migration.number, status: "Running", reason: "no-option" } }]));
  await cancelRun(db, cancelled.id, { projects: plan });
  expect(await statusOf(migration.number)).toBe("Ready");
  expect((await planEvents(cancelled.id)).map(([type]) => type)).toEqual(["plan.skipped"]);
});

test("a run that moved its task before runs recorded where from puts it back to Ready", async () => {
  const { plan, task, runWithoutMove, statusOf, setStatus } = await planned();
  const migration = await task("Add the migration", "Running");
  const cancelled = await runWithoutMove([migration]);
  await db.transaction((tx) => appendEvents(tx, cancelled.id, [{ type: "plan.status", payload: { issue: migration.number, status: "Running" } }]));
  setStatus(migration.number, "In review");
  await cancelRun(db, cancelled.id, { projects: plan });
  expect(await statusOf(migration.number)).toBe("Ready");
});

test("cancelling an older run leaves a task whose newer run is active alone", async () => {
  const { plan, task, start, statusOf, setStatus } = await planned();
  const migration = await task("Add the migration");
  const docs = await task("Document the migration");
  const older = await start([migration, docs]);
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, older.id));
  setStatus(migration.number, "Ready");
  await start([migration]);
  await cancelRun(db, older.id, { projects: plan });
  // The newer run owns the migration task; the docs task had only the cancelled run.
  expect(await statusOf(migration.number)).toBe("Running");
  expect(await statusOf(docs.number)).toBe("Ready");
});

test("stopping a run whose loop ran out sets its task back to Ready", async () => {
  const { plan, task, start, statusOf } = await planned();
  const migration = await task("Add the migration");
  const stuck = await start([migration]);
  const [planner] = await db.update(nodeExecutions).set({ status: "passed" }).where(eq(nodeExecutions.runId, stuck.id)).returning();
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, stuck.id));
  await db.transaction((tx) =>
    appendEvents(tx, stuck.id, [
      { type: "edge.exhausted", payload: { edgeKey: "planner->planner", attempts: 3 }, nodeExecutionId: planner!.id },
      { type: "run.failed", payload: { reason: "loop_exhausted", nodeKey: "planner", awaiting: "repair" } },
    ]),
  );
  await resolveExhaustedLoop(db, stuck.id, "stop", { projects: plan });
  expect(await statusOf(migration.number)).toBe("Ready");
});

test("abort at a gate a loop that ran out reached cancels the run and sets its task back to Ready", async () => {
  const { plan, task, start, statusOf } = await planned();
  const migration = await task("Add the migration");
  const stuck = await start([migration]);
  const [gate] = await db.update(nodeExecutions).set({ nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting" }).where(eq(nodeExecutions.runId, stuck.id)).returning();
  const [question] = await db
    .insert(questions)
    .values({ runId: stuck.id, nodeExecutionId: gate!.id, question: "The loop ran out.", options: ["retry", "continue", "abort"], context: { reason: "loop_exhausted", edgeKey: "planner->planner", from: "planner" } })
    .returning();
  await answerQuestion(db, question!.id, { answer: "abort", option: "abort", answeredBy: "krister" }, { projects: plan });
  expect((await inspect(db, stuck.id)).run.status).toBe("cancelled");
  expect(await statusOf(migration.number)).toBe("Ready");
});
