import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { eq, planPins, projects, runs } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { createProject, saveGraphVersion } from "@/server/graphs";

const db = createTestDb();
// The dashboard's environment: the test database, and fakes where it would reach GitHub.
const env = vi.hoisted(() => ({ github: undefined as unknown, projects: undefined as unknown, redirects: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => void env.redirects.push(path) }));
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/github", () => ({ getGitHub: () => env.github, getProjects: () => env.projects }));

const { addDateFieldsAction, runAgainAction, scheduleAction, setCapacityAction, setPlanBudgetAction, setPlanModeAction, startRunAction, unpinAction, writeOrderAction } = await import("./actions");

beforeEach(async () => {
  await truncateAll(db);
  env.redirects.length = 0;
});
afterAll(() => db.$client.end());

const repo = { owner: "octo", name: "sample" };

/** A project with a plan and one task in Ready. */
async function readyTask() {
  const github = new FakeGitHub();
  const plan = new FakeProjects(github);
  env.github = github;
  env.projects = plan;
  const { number } = await plan.createProject("octo", repo, "sandbox plan");
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, project.id));
  await saveGraphVersion(db, { projectId: project.id, name: "linear", document: linear });
  const task = await plan.createIssue(repo, { project: number, title: "Add the migration", body: "Add the column.", labels: ["task"] });
  plan.itemsOf(repo).get(task.number)!.status = "Ready";
  return { project, plan, issue: task.number, statusOf: () => plan.getStatus(repo, number, task.number) };
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

test("starting a run from the Issues tab sets the task to Running", async () => {
  const { project, issue, statusOf } = await readyTask();
  await startRunAction({}, form({ projectId: project.id, graphName: "linear", task: "", issue: String(issue) }));
  expect(env.redirects).toEqual([expect.stringMatching(new RegExp(`/projects/${project.id}/runs/`))]);
  expect(await statusOf()).toBe("Running");
});

test("running a cancelled run again sets its task to Running", async () => {
  const { project, issue, statusOf } = await readyTask();
  await startRunAction({}, form({ projectId: project.id, graphName: "linear", task: "", issue: String(issue) }));
  const [first] = await db.select().from(runs);
  await db.update(runs).set({ status: "cancelled" }).where(eq(runs.id, first!.id));
  (env.projects as FakeProjects).itemsOf(repo).get(issue)!.status = "Ready";
  // The action redirects to the new run; it answers only with an error.
  expect(await runAgainAction({}, form({ runId: first!.id }))).toBeUndefined();
  expect(env.redirects).toHaveLength(2);
  expect(await statusOf()).toBe("Running");
});

test("runs started and run again from the dashboard record dashboard as the starter", async () => {
  const { project, issue } = await readyTask();
  await startRunAction({}, form({ projectId: project.id, graphName: "linear", task: "", issue: String(issue) }));
  const [first] = await db.select().from(runs);
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, first!.id));
  await runAgainAction({}, form({ runId: first!.id }));
  expect((await db.select().from(runs)).map((r) => r.startedBy)).toEqual(["dashboard", "dashboard"]);
});

test("the schedule dialog's save writes Start and Target through scheduleAction and refuses a Target before Start", async () => {
  const { project, plan, issue } = await readyTask();
  expect(await scheduleAction({ projectId: project.id, issue, start: "2026-10-06", target: "2026-10-09" })).toEqual({ ok: true });
  expect(plan.itemsOf(repo).get(issue)).toMatchObject({ start: "2026-10-06", target: "2026-10-09" });
  // Clear empties a field.
  expect(await scheduleAction({ projectId: project.id, issue, start: null, target: "2026-10-09" })).toEqual({ ok: true });
  expect(plan.itemsOf(repo).get(issue)?.start).toBeUndefined();
  expect(await scheduleAction({ projectId: project.id, issue, start: "2026-10-12", target: "2026-10-09" })).toEqual({ ok: false, error: expect.stringContaining("before its Start") });
  expect(await scheduleAction({ projectId: "not a project", issue, start: "2026-10-06", target: null })).toEqual({ ok: false, error: expect.any(String) });
});

test("Add date fields gives the plan's Project its Start and Target fields", async () => {
  const { project, plan, issue } = await readyTask();
  plan.plans.get("octo/sample")!.project.dateFields = { start: undefined, target: undefined };
  expect(await scheduleAction({ projectId: project.id, issue, start: "2026-10-06", target: null })).toEqual({ ok: false, error: expect.stringContaining("no Start and Target date fields") });
  expect(await addDateFieldsAction({ projectId: project.id })).toEqual({ ok: true });
  expect(plan.plans.get("octo/sample")!.project.dateFields).toEqual({ start: expect.any(String), target: expect.any(String) });
  expect(await scheduleAction({ projectId: project.id, issue, start: "2026-10-06", target: null })).toEqual({ ok: true });
});

test("setCapacityAction stores hours a day for the project and refuses a value outside 1 to 24", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  const capacity = async () => (await db.select({ hours: projects.planHoursPerDay }).from(projects).where(eq(projects.id, project.id)))[0]?.hours;
  expect(await capacity()).toBe(6);
  expect(await setCapacityAction({ projectId: project.id, hours: 7.5 })).toEqual({ ok: true });
  expect(await capacity()).toBe(7.5);
  expect(await setCapacityAction({ projectId: project.id, hours: 24 })).toEqual({ ok: true });
  expect(await setCapacityAction({ projectId: project.id, hours: 1 })).toEqual({ ok: true });
  for (const hours of [0, 0.5, 24.5, 25, Number.NaN]) {
    expect(await setCapacityAction({ projectId: project.id, hours })).toEqual({ ok: false, error: "Hours a day is a number from 1 to 24." });
  }
  expect(await capacity()).toBe(1);
  expect(await setCapacityAction({ projectId: "not a project", hours: 6 })).toEqual({ ok: false, error: expect.any(String) });
});

test("setPlanBudgetAction saves files and steps, keeps the default for one left empty, clears both when empty and refuses one out of range", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  const budget = async () => (await db.select({ budget: projects.planBudget }).from(projects).where(eq(projects.id, project.id)))[0]?.budget;
  expect(await setPlanBudgetAction({ projectId: project.id, files: " 8 ", steps: "6" })).toEqual({ ok: true });
  expect(await budget()).toEqual({ files: 8, steps: 6 });
  expect(await setPlanBudgetAction({ projectId: project.id, files: "20", steps: "" })).toEqual({ ok: true });
  expect(await budget()).toEqual({ files: 20, steps: 12 });
  expect(await setPlanBudgetAction({ projectId: project.id, files: "", steps: "" })).toEqual({ ok: true });
  expect(await budget()).toBeNull();
  for (const [files, steps] of [["0", ""], ["", "two"], ["501", "6"]]) {
    expect(await setPlanBudgetAction({ projectId: project.id, files: files!, steps: steps! })).toEqual({ ok: false, error: expect.stringMatching(/whole number from 1 to 500/) });
  }
  expect(await budget()).toBeNull();
});

test("setPlanModeAction stores Flow or Timeline and keeps Start, Target and Project order on GitHub", async () => {
  const { project, plan, issue } = await readyTask();
  const number = (await db.select({ n: projects.planProjectNumber }).from(projects).where(eq(projects.id, project.id)))[0]!.n!;
  const later = await plan.createIssue(repo, { project: number, title: "Add the API", body: "Read the column.", labels: ["task"] });
  expect(await scheduleAction({ projectId: project.id, issue, start: "2026-10-06", target: "2026-10-09" })).toEqual({ ok: true });
  const github = async () => (await plan.listItems("octo", number, repo)).map((i) => ({ number: i.number, position: i.position, start: i.start, target: i.target }));
  const before = await github();
  expect(before.map((i) => i.number)).toEqual([issue, later.number]);
  const mode = async () => (await db.select({ mode: projects.planMode }).from(projects).where(eq(projects.id, project.id)))[0]?.mode;
  expect(await mode()).toBe("flow");

  expect(await setPlanModeAction({ projectId: project.id, mode: "timeline" })).toEqual({ ok: true });
  expect(await mode()).toBe("timeline");
  expect(await setPlanModeAction({ projectId: project.id, mode: "flow" })).toEqual({ ok: true });
  expect(await mode()).toBe("flow");
  // Switching writes nothing to GitHub: the dates stay on the items and Project order stays as it was.
  expect(await github()).toEqual(before);
  expect(before[0]).toMatchObject({ start: "2026-10-06", target: "2026-10-09" });

  expect(await setPlanModeAction({ projectId: project.id, mode: "gantt" as "flow" })).toEqual({ ok: false, error: expect.any(String) });
  expect(await setPlanModeAction({ projectId: "not a project", mode: "timeline" })).toEqual({ ok: false, error: expect.any(String) });
  expect(await mode()).toBe("flow");
});

test("writeOrderAction saves the order and pins the card as the person's drop, and unpinAction removes the pin", async () => {
  const { project, plan, issue } = await readyTask();
  const number = (await db.select({ n: projects.planProjectNumber }).from(projects).where(eq(projects.id, project.id)))[0]!.n!;
  const later = (await plan.createIssue(repo, { project: number, title: "Add the API", body: "", labels: ["task"] })).number;
  plan.itemsOf(repo).get(later)!.status = "Ready";
  const pins = async () => db.select({ issue: planPins.issue, pinnedBy: planPins.pinnedBy, reason: planPins.reason }).from(planPins);

  expect(await writeOrderAction({ projectId: project.id, shown: [issue, later], queue: [later, issue], pin: [later] })).toEqual({ ok: true });
  expect((await plan.listItems("octo", number, repo)).map((i) => i.number)).toEqual([later, issue]);
  expect(await pins()).toEqual([{ issue: later, pinnedBy: "person", reason: "drop" }]);

  // The page showed the old order: the write is refused with the sentence and nothing changes.
  expect(await writeOrderAction({ projectId: project.id, shown: [issue, later], queue: [later, issue], pin: [later] })).toEqual({
    ok: false,
    error: "The order changed on GitHub since the page loaded. The Flow now shows the new order.",
  });

  expect(await unpinAction({ projectId: project.id, issue: later })).toEqual({ ok: true });
  expect(await pins()).toEqual([]);
  expect(await writeOrderAction({ projectId: project.id, shown: [], queue: [], reason: "nap" as "drop" })).toEqual({ ok: false, error: expect.any(String) });
});
