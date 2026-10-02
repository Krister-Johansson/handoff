import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, nodeExecutions, permissionRequests, projects, questions, runs } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs.ts";
import { loadOverview } from "./overview.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const repo = { owner: "octo", name: "sample" };
const NOW = new Date("2026-10-02T12:00:00Z");
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000);

async function project(name = "sandbox") {
  const created = await createProject(db, { name, repo: `octo/${name === "sandbox" ? "sample" : name}`, defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: created.id, name: "g", document: linear });
  const start = (task: string, issues: number[] = [], github?: FakeGitHub) => startRunFromGraph(db, { projectId: created.id, graphName: "g", task, issues }, github);
  return { project: created, start };
}

/** A project whose repository has a GitHub Project as its plan, with helpers to add issues to it. */
async function planned() {
  const github = new FakeGitHub();
  const plan = new FakeProjects(github);
  const { number } = await plan.createProject("octo", repo, "sandbox plan");
  const { project: created, start } = await project();
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, created.id));
  const issue = async (title: string, labels: string[], parent?: number) => (await plan.createIssue(repo, { project: number, title, body: "", labels, parent })).number;
  const status = (n: number, value: string) => {
    plan.itemsOf(repo).get(n)!.status = value;
  };
  return { github, plan, project: created, start: (task: string, issues: number[] = []) => start(task, issues, github), issue, status };
}

test("Needs you holds this project's items only, and Running now lists its active runs newest first, marked when they wait on a person", async () => {
  const { project: ours, start } = await project();
  const { start: startElsewhere } = await project("elsewhere");

  const coding = await start("#55 Shaping tools");
  await db.update(runs).set({ status: "running", createdAt: hoursAgo(1) }).where(eq(runs.id, coding.id));
  await db.update(nodeExecutions).set({ status: "running" }).where(eq(nodeExecutions.runId, coding.id));

  const asking = await start("#70 Speak replies");
  const coder = await seedExecution(db, asking.id, { nodeKey: "coder", status: "running" });
  await db.insert(permissionRequests).values({ id: crypto.randomUUID(), runId: asking.id, nodeExecutionId: coder.id, toolName: "Bash", input: { command: "npx playwright install chromium" } });
  await db.update(runs).set({ status: "running", createdAt: hoursAgo(0.5) }).where(eq(runs.id, asking.id));

  const theirs = await startElsewhere("Theirs");
  const gate = await seedExecution(db, theirs.id, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  await db.insert(questions).values({ runId: theirs.id, nodeExecutionId: gate.id, question: "Which name?", context: { reason: "needs_input" } });
  await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, theirs.id));

  const overview = await loadOverview(db, undefined, undefined, ours.id, { now: NOW });
  expect(overview.needsYou.permissions?.map((p) => p.runId)).toEqual([asking.id]);
  expect(overview.needsYou.questions).toEqual([]);
  expect(overview.running.map((r) => [r.task, r.needsYou, r.line.now.text])).toEqual([
    ["#70 Speak replies", true, "Code asks to run a command"],
    ["#55 Shaping tools", false, "Plan is working"],
  ]);
});

test("Finished in the last day lists the project's runs that succeeded since then, newest first, with when they finished", async () => {
  const { project: ours, start } = await project();
  const finished = async (task: string, status: "succeeded" | "failed" | "cancelled", hours: number) => {
    const run = await start(task);
    await db.update(runs).set({ status, finishedAt: hoursAgo(hours), createdAt: hoursAgo(hours + 1) }).where(eq(runs.id, run.id));
    return run;
  };
  const recent = await finished("#53 Plan read model", "succeeded", 18);
  const earlier = await finished("#52 Projects port", "succeeded", 21);
  await finished("#51 Too old", "succeeded", 30);
  await finished("#50 Failed", "failed", 2);
  await finished("#49 Cancelled", "cancelled", 2);

  const overview = await loadOverview(db, undefined, undefined, ours.id, { now: NOW });
  expect(overview.finished.map((r) => [r.id, r.finishedAt])).toEqual([
    [recent.id, hoursAgo(18)],
    [earlier.id, hoursAgo(21)],
  ]);
  expect(overview.finished[0]!.line.now.text).toBe("Done.");
});

test("Features in progress are the epics with a task Running or In review, each with its progress and only those tasks, marked when their run waits on a person", async () => {
  const { github, plan, project: ours, start, issue, status } = await planned();
  const management = await issue("Project management", ["epic"]);
  const story = await issue("Plan read model", ["story"], management);
  const review = await issue("Status writes from runs", ["task"], story);
  const running = await issue("Approval card summaries", ["task"], story);
  const shaping = await issue("Shaped later", ["task"], story);
  const done = await issue("Plan read model and the Ready gate", ["task"], management);
  const quiet = await issue("Voice", ["epic"]);
  const ready = await issue("Voice picker", ["task"], quiet);
  status(review, "In review");
  status(running, "Running");
  status(shaping, "Shaping");
  status(done, "Done");
  status(ready, "Ready");

  const asking = await start("#56 Approval card summaries", [running]);
  const gate = await seedExecution(db, asking.id, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  await db.insert(questions).values({ runId: asking.id, nodeExecutionId: gate.id, question: "Replace the body?", context: { reason: "needs_input" } });
  await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, asking.id));

  const overview = await loadOverview(db, github, plan, ours.id, { now: NOW });
  if (overview.work.kind !== "plan") throw new Error("expected the plan");
  expect(overview.work.project.title).toBe("sandbox plan");
  expect(overview.work.features.map((f) => [f.number, f.title, f.progress.done, f.progress.total])).toEqual([[management, "Project management", 1, 4]]);
  expect(overview.work.features[0]!.tasks.map((t) => [t.number, t.status, t.needsYou])).toEqual([
    [review, "In review", false],
    [running, "Running", true],
  ]);
});

test("Ready to start lists the Ready tasks no run works on, unblocked first, each with its epic, and counts the unplanned issues to do", async () => {
  const { github, plan, project: ours, start, issue, status } = await planned();
  const management = await issue("Project management", ["epic"]);
  const story = await issue("Plan page", ["story"], management);
  const voice = await issue("Voice", ["epic"]);
  const speak = await issue("Speak replies", ["task"], voice);
  const picker = await issue("Voice picker", ["task"], voice);
  const tree = await issue("Plan page tree and board", ["task"], story);
  const taken = await issue("Already started", ["task"], story);
  const stray = await issue("Stray task", ["task"]);
  for (const n of [picker, tree, taken, stray]) status(n, "Ready");
  status(speak, "Running");
  github.issues.get(picker)!.blockedBy = [speak];
  await start("#taken", [taken]);
  github.issues.set(90, { number: 90, title: "Outside the plan", url: "https://github.com/octo/sample/issues/90", body: "", state: "open" });
  github.issues.set(91, { number: 91, title: "Also outside", url: "https://github.com/octo/sample/issues/91", body: "", state: "open" });
  await start("#91", [91]);

  const overview = await loadOverview(db, github, plan, ours.id, { now: NOW });
  if (overview.work.kind !== "plan") throw new Error("expected the plan");
  expect(overview.work.ready.map((t) => [t.number, t.epic, t.blockedBy])).toEqual([
    [tree, "Project management", []],
    [stray, undefined, []],
    [picker, "Voice", [speak]],
  ]);
  expect(overview.work.unplannedToDo).toBe(1);
});

test("without a plan the work is the repository's open issues: those with runs, and those to do", async () => {
  const github = new FakeGitHub();
  const { project: ours, start } = await project();
  const open = (number: number, title: string) => github.issues.set(number, { number, title, url: `https://github.com/octo/sample/issues/${number}`, body: "", state: "open" });
  open(3, "F03 Prisma schema");
  open(5, "F05 User model");
  open(12, "Add rate limiting");
  const waiting = await start("#3", [3], github);
  await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, waiting.id));
  const failed = await start("#5", [5], github);
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, failed.id));
  const cancelled = await start("#12", [12], github);
  await db.update(runs).set({ status: "cancelled" }).where(eq(runs.id, cancelled.id));

  const overview = await loadOverview(db, github, new FakeProjects(github), ours.id, { now: NOW });
  if (overview.work.kind !== "issues") throw new Error("expected the issues");
  expect(overview.work.reason).toBe("no-plan");
  if ("error" in overview.work.issues) throw new Error(overview.work.issues.error);
  expect(overview.work.issues.withRuns.map((i) => [i.number, i.run?.status]).sort()).toEqual([
    [3, "waiting"],
    [5, "failed"],
  ]);
  expect(overview.work.issues.toDo.map((i) => [i.number, i.run?.status])).toEqual([[12, "cancelled"]]);
});
