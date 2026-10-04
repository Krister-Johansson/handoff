import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { eq, events, projects, projectSchedulers, runs, sql } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { cancelRun } from "@handoff/engine/operations";
import { OctokitProjects } from "@handoff/github";
import { fakeFetch, fakeGraphql, FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs.ts";
import {
  addDateFields,
  addEstimateFields,
  createEpic,
  createStory,
  createTask,
  moveItem,
  moveToReady,
  moveToShaping,
  planIssue,
  saveArrange,
  schedule,
  setSize,
  setupPlan,
  type ShapingDeps,
} from "./shaping.ts";

const db = createTestDb();
const repo = { owner: "octo", name: "sample" };
let github: FakeGitHub;
let plan: FakeProjects;
let deps: ShapingDeps;
let projectId: string;

beforeEach(async () => {
  await truncateAll(db);
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  projectId = project.id;
  await saveGraphVersion(db, { projectId, name: "linear", document: linear });
  github = new FakeGitHub();
  for (const number of [11, 12]) {
    github.issues.set(number, { number, title: `Issue ${number}`, url: `https://github.com/octo/sample/issues/${number}`, body: `Body ${number}`, state: "open" });
  }
  plan = new FakeProjects(github);
  deps = { db, github, projects: plan };
});
afterAll(() => db.$client.end());

/** Plans the sandbox project in Timeline mode, as every project added before the plan mode does. */
const timeline = () => db.update(projects).set({ planMode: "timeline" }).where(eq(projects.id, projectId));

/** A run started on issues before the project had a plan, as run 64fde8ef was. */
const runBeforePlan = (issues: number[]) => startRunFromGraph(db, { projectId, graphName: "linear", task: "", issues }, github);

const statusOf = (issue: number) => plan.itemsOf(repo).get(issue)?.status;
const planEvents = async (runId: string) =>
  (await db.select({ type: events.type, payload: events.payload }).from(events).where(eq(events.runId, runId))).filter((e) => e.type.startsWith("plan."));

/** A PlanItems node for an open task of octo/sample with nothing set. */
const taskNode = (number: number) => ({
  status: { __typename: "ProjectV2ItemFieldSingleSelectValue", name: "Shaping" },
  content: {
    __typename: "Issue",
    number,
    title: `Task ${number}`,
    url: `https://github.com/octo/sample/issues/${number}`,
    state: "OPEN",
    updatedAt: "2026-10-01T10:00:00Z",
    repository: { name: "sample", owner: { login: "octo" } },
    labels: { nodes: [{ name: "task" }] },
    assignees: { nodes: [] },
    issueType: null,
    parent: null,
    subIssuesSummary: { total: 0, completed: 0 },
    blockedBy: { nodes: [] },
    closedByPullRequestsReferences: { nodes: [] },
  },
});

test("schedule writes 60 items' dates to GitHub in a dozen requests at most", async () => {
  const issues = Array.from({ length: 60 }, (_, i) => 100 + i);
  const dateField = (id: string) => ({ __typename: "ProjectV2Field", id, dataType: "DATE" });
  const { fetch, calls, operations } = fakeGraphql(
    {
      PlanProject: () => ({ repositoryOwner: { __typename: "User", projectV2: { id: "PVT_3", number: 3, url: "u", title: "t", field: null, start: dateField("F_start"), target: dateField("F_target") } } }),
      PlanItems: () => ({ repositoryOwner: { __typename: "User", projectV2: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: issues.map(taskNode) } } } }),
      PlanItemIds: () => ({ repository: Object.fromEntries(issues.map((n) => [`i${n}`, { projectItems: { nodes: [{ id: `PVTI_${n}`, project: { id: "PVT_3" } }] } }])) }),
      SetManyPlanFields: () => ({}),
    },
    { "GET /user": () => ({ json: { login: "octo" }, headers: { "x-oauth-scopes": "repo, project" } }) },
  );
  await db.update(projects).set({ planProjectNumber: 3, planMode: "timeline" }).where(eq(projects.id, projectId));
  const items = issues.map((issue, i) => ({ issue, start: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}`, target: "2026-10-30" }));

  const result = await schedule({ db, github, projects: OctokitProjects.withToken("t", { fetch, throttle: false }) }, projectId, items);

  expect(result.scheduled).toHaveLength(60);
  const written = operations.filter((o) => o.operation === "SetManyPlanFields").flatMap((o) => Object.keys(o.variables).filter((k) => k.endsWith("Value")));
  expect(written).toHaveLength(120);
  expect(calls.length).toBeLessThanOrEqual(12);
});

test("setup_plan in an organization whose SSO the token is not authorized for answers with the sentence and stores nothing", async () => {
  const url = "https://github.com/orgs/octo/sso?authorization_request=A1";
  const { fetch } = fakeFetch({
    "GET /user": () => ({ json: { login: "ann" }, headers: { "x-oauth-scopes": "repo, project" } }),
    "POST /graphql": () => ({ status: 403, headers: { "x-github-sso": `required; url=${url}` }, json: { message: "Resource protected by organization SAML enforcement." } }),
  });

  await expect(setupPlan({ db, github, projects: OctokitProjects.withToken("t", { fetch, throttle: false }) }, projectId, { use: 4 })).rejects.toThrow(
    `octo uses SAML single sign-on, and GITHUB_TOKEN is not authorized for it. Authorize the token at ${url} within the hour, or on GitHub under Settings, Developer settings, Personal access tokens, Configure SSO.`,
  );
  const [stored] = await db.select({ number: projects.planProjectNumber }).from(projects).where(eq(projects.id, projectId));
  expect(stored).toEqual({ number: null });
});

test("plan_issue puts an issue whose run is active in Running and records it on the run; one without a run stays in Shaping", async () => {
  const run = await runBeforePlan([11]);
  await setupPlan(deps, projectId);
  expect(await planIssue(deps, projectId, { issue: 11 })).toMatchObject({ number: 11, status: "Running" });
  expect(await statusOf(11)).toBe("Running");
  expect(await planEvents(run.id)).toEqual([{ type: "plan.status", payload: { issue: 11, status: "Running", from: "Shaping" } }]);

  expect(await planIssue(deps, projectId, { issue: 12 })).toMatchObject({ number: 12, status: "Shaping" });
  expect(await statusOf(12)).toBe("Shaping");
});

test("plan_issue puts an issue whose active run has opened its pull request in In review", async () => {
  const run = await runBeforePlan([11]);
  await db.update(runs).set({ status: "waiting", prNumber: 88 }).where(eq(runs.id, run.id));
  await setupPlan(deps, projectId);
  expect(await planIssue(deps, projectId, { issue: 11 })).toMatchObject({ number: 11, status: "In review" });
  expect(statusOf(11)).toBe("In review");
  expect(await planEvents(run.id)).toEqual([{ type: "plan.status", payload: { issue: 11, status: "In review", from: "Shaping" } }]);
});

test("setup_plan taking over a Project sets the items active runs work on to the runs' Status and leaves the others", async () => {
  const running = await runBeforePlan([11]);
  const reviewing = await runBeforePlan([12]);
  await db.update(runs).set({ prNumber: 88 }).where(eq(runs.id, reviewing.id));
  github.issues.set(13, { number: 13, title: "Issue 13", url: "https://github.com/octo/sample/issues/13", body: "Body 13", state: "open" });
  const roadmap = await plan.createProject("octo", { owner: "octo", name: "roadmap" }, "Roadmap");
  plan.plans.get("octo/roadmap")!.items = new Map([
    [11, { status: "Shaping" }],
    [12, { status: "Running" }],
    [13, { status: "Shaping" }],
  ]);

  const adopted = await setupPlan(deps, projectId, { use: roadmap.number });
  expect(adopted).toMatchObject({
    statuses_from_runs: [
      { issue: 11, status: "Running", run: running.id },
      { issue: 12, status: "In review", run: reviewing.id },
    ],
  });
  expect([statusOf(11), statusOf(12), statusOf(13)]).toEqual(["Running", "In review", "Shaping"]);
  expect(await planEvents(running.id)).toEqual([{ type: "plan.status", payload: { issue: 11, status: "Running", from: "Shaping" } }]);
  expect(await planEvents(reviewing.id)).toEqual([{ type: "plan.status", payload: { issue: 12, status: "In review", from: "Running" } }]);
});

test("setup_plan again on a plan whose item landed in Shaping during its run sets it to Running", async () => {
  const run = await runBeforePlan([11]);
  const created = await setupPlan(deps, projectId);
  expect(created).toMatchObject({ created: true, statuses_from_runs: [] });
  // An issue added in Shaping while its run was active, as before the fix.
  plan.itemsOf(repo).set(11, { status: "Shaping" });
  plan.itemsOf(repo).set(12, { status: "Shaping" });

  expect(await setupPlan(deps, projectId)).toMatchObject({ created: false, statuses_from_runs: [{ issue: 11, status: "Running", run: run.id }] });
  expect([statusOf(11), statusOf(12)]).toEqual(["Running", "Shaping"]);
  expect(await planEvents(run.id)).toEqual([{ type: "plan.status", payload: { issue: 11, status: "Running", from: "Shaping" } }]);
  // Once the Status agrees with the run, setup_plan writes nothing more.
  expect(await setupPlan(deps, projectId)).toMatchObject({ statuses_from_runs: [] });
  expect(await planEvents(run.id)).toHaveLength(1);
});

test("plan_issue records a skipped write on the run and reports Shaping when the Project lacks the run's Status", async () => {
  const run = await runBeforePlan([11]);
  await setupPlan(deps, projectId);
  plan.plans.get("octo/sample")!.project.statusOptions.Running = undefined;
  expect(await planIssue(deps, projectId, { issue: 11 })).toMatchObject({ number: 11, status: "Shaping" });
  expect(statusOf(11)).toBe("Shaping");
  expect(await planEvents(run.id)).toEqual([{ type: "plan.skipped", payload: { issue: 11, status: "Running", reason: "no-option" } }]);
});

test("plan_issue leaves an issue whose run ended in Shaping and writes nothing on that run", async () => {
  const run = await runBeforePlan([11]);
  await db.update(runs).set({ status: "succeeded", prNumber: 88 }).where(eq(runs.id, run.id));
  await setupPlan(deps, projectId);
  expect(await planIssue(deps, projectId, { issue: 11 })).toMatchObject({ number: 11, status: "Shaping" });
  expect(statusOf(11)).toBe("Shaping");
  expect(await planEvents(run.id)).toEqual([]);
});

test("cancelling a run whose task plan_issue set to Running puts the task back in Shaping", async () => {
  const run = await runBeforePlan([11]);
  await setupPlan(deps, projectId);
  await planIssue(deps, projectId, { issue: 11 });
  await cancelRun(db, run.id, { projects: plan });
  expect(statusOf(11)).toBe("Shaping");
});

test("cancelling a run whose task setup_plan set to Running puts the task back in the Status it had", async () => {
  const run = await runBeforePlan([11, 12]);
  const roadmap = await plan.createProject("octo", { owner: "octo", name: "roadmap" }, "Roadmap");
  plan.plans.get("octo/roadmap")!.items = new Map([
    [11, { status: "Shaping" }],
    [12, { status: "Ready" }],
  ]);
  await setupPlan(deps, projectId, { use: roadmap.number });
  expect([statusOf(11), statusOf(12)]).toEqual(["Running", "Running"]);
  await cancelRun(db, run.id, { projects: plan });
  expect([statusOf(11), statusOf(12)]).toEqual(["Shaping", "Ready"]);
});

test("moving tasks to Ready nudges the project's scheduler", async () => {
  await setupPlan(deps, projectId);
  await planIssue(deps, projectId, { issue: 11 });
  await db
    .insert(projectSchedulers)
    .values({ projectId, enabled: true, graphName: "linear", lastCheckAt: sql`now() - interval '30 seconds'`, nextCheckAt: sql`now() + interval '30 seconds'` });

  await moveToReady(deps, projectId, [11]);

  const [row] = await db.select({ due: sql<boolean>`${projectSchedulers.nextCheckAt} <= now()` }).from(projectSchedulers).where(eq(projectSchedulers.projectId, projectId));
  expect(row!.due).toBe(true);
});

/** A story #20 with tasks #21 and #22 that both start on Oct 4, #22 blocked by #21, in a plan with Size and Estimate. */
async function sizedPlan() {
  await timeline();
  await setupPlan(deps, projectId);
  const issue = (number: number, labels: string[], blockedBy: number[] = []) =>
    github.issues.set(number, { number, title: `Issue ${number}`, url: `https://github.com/octo/sample/issues/${number}`, body: "", state: "open", labels, blockedBy });
  issue(20, ["story"]);
  issue(21, ["task"]);
  issue(22, ["task"], [21]);
  plan.parents.set(21, 20);
  plan.parents.set(22, 20);
  const items = plan.itemsOf(repo);
  items.set(20, { status: "Shaping" });
  items.set(21, { status: "Shaping", start: "2026-10-04", target: "2026-10-04", size: "L" });
  items.set(22, { status: "Shaping", start: "2026-10-04", target: "2026-10-04" });
  return items;
}

test("setSize writes Size and moves the Target of a task with a Start", async () => {
  const items = await sizedPlan();

  // #22 starts after #21's 2 hours on Oct 4: 2 and 9 hours at 6 a day end on Oct 5.
  expect(await setSize(deps, projectId, { issue: 22, estimate: 9 })).toEqual({
    issue: 22,
    estimate: { from: null, to: 9 },
    target: { from: "2026-10-04", to: "2026-10-05" },
  });
  expect(items.get(22)).toMatchObject({ estimate: 9, target: "2026-10-05", start: "2026-10-04" });

  // A size keeps the estimate, so the Target stays.
  expect(await setSize(deps, projectId, { issue: 22, size: "S" })).toEqual({ issue: 22, size: { from: null, to: "S" } });
  expect(items.get(22)).toMatchObject({ size: "S", estimate: 9, target: "2026-10-05" });

  // Back to the forecast: S's default of 30 minutes after #21's 2 hours ends on Oct 4. 0 is no estimate.
  expect(await setSize(deps, projectId, { issue: 22, estimate: 0 })).toEqual({
    issue: 22,
    estimate: { from: 9, to: null },
    target: { from: "2026-10-05", to: "2026-10-04" },
  });
  expect(items.get(22)?.estimate).toBeUndefined();

  // A task without a Start keeps its dates.
  items.set(23, { status: "Shaping" });
  github.issues.set(23, { number: 23, title: "Issue 23", url: "https://github.com/octo/sample/issues/23", body: "", state: "open", labels: ["task"] });
  expect(await setSize(deps, projectId, { issue: 23, size: "M" })).toEqual({ issue: 23, size: { from: null, to: "M" } });
  expect(items.get(23)).toEqual({ status: "Shaping", size: "M" });

  await expect(setSize(deps, projectId, { issue: 20, size: "M" })).rejects.toThrow("#20 is a story. Only tasks have a size; stories and epics sum their tasks.");
  await expect(setSize(deps, projectId, { issue: 99, size: "M" })).rejects.toThrow("#99 is not in the plan of sandbox. Add it with plan_issue first.");
  await expect(setSize(deps, projectId, { issue: 22, estimate: -1 })).rejects.toThrow("An estimate is hours from 0 to 1000.");

  plan.plans.get("octo/sample")!.project.estimateFields = undefined;
  await expect(setSize(deps, projectId, { issue: 22, size: "M" })).rejects.toThrow(
    "GitHub Project #1 has no Size and no Estimate field. Add them with Add the fields on the Plan timeline, or run setup_plan.",
  );
  expect(items.get(22)?.size).toBe("S");
});

test("setup_plan creates Size and Estimate on a new Project and adds them when adopting", async () => {
  await timeline();
  const created = await setupPlan(deps, projectId);
  expect(created).toMatchObject({ created: true, added_estimate_fields: ["Size", "Estimate"] });
  expect(plan.plans.get("octo/sample")!.project.estimateFields).toEqual({
    size: { id: "field-size", options: { S: "opt-size-s", M: "opt-size-m", L: "opt-size-l" } },
    estimate: "field-estimate",
  });
  expect(await setupPlan(deps, projectId)).toMatchObject({ created: false, added_estimate_fields: [] });

  // Adopting a Project whose Size lacks S, M and L adds them; a Project without Estimate gets it.
  await truncateAll(db);
  projectId = (await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" })).id;
  await timeline();
  const roadmap = await plan.createProject("octo", { owner: "octo", name: "roadmap" }, "Roadmap");
  plan.plans.get("octo/roadmap")!.project.estimateFields = { size: { id: "field-old-size", options: { S: undefined, M: undefined, L: undefined } }, estimate: undefined };
  const adopted = await setupPlan(deps, projectId, { use: roadmap.number });
  expect(adopted).toMatchObject({ created: false, added_estimate_fields: ["Size", "Estimate"] });
  expect((await plan.getProject("octo", roadmap.number))?.estimateFields).toEqual({
    size: { id: "field-old-size", options: { S: "opt-size-s", M: "opt-size-m", L: "opt-size-l" } },
    estimate: "field-estimate",
  });

  // The timeline banner's Add the fields does the same on a plan that has none.
  plan.plans.get("octo/sample")!.project.estimateFields = undefined;
  await expect(addEstimateFields(deps, projectId)).resolves.toEqual({ estimate_fields: expect.objectContaining({ estimate: "field-estimate" }) });
});

test("in a Flow project Add the fields adds Size and no Estimate, and refuses the date fields", async () => {
  await setupPlan(deps, projectId);
  const project = plan.plans.get("octo/sample")!.project;
  project.estimateFields = undefined;

  await addEstimateFields(deps, projectId);
  expect(project.estimateFields).toEqual({ size: { id: "field-size", options: { S: "opt-size-s", M: "opt-size-m", L: "opt-size-l" } }, estimate: undefined });

  await expect(addDateFields(deps, projectId)).rejects.toThrow("sandbox plans in Flow mode, which has no dates. Its Project needs no Start or Target field.");
  expect(project.dateFields?.start).toBeUndefined();
  expect(project.dateFields?.target).toBeUndefined();
});

test("moveItem writes Start, Target and Estimate in one request and refuses a Target before Start", async () => {
  const items = await sizedPlan();
  const listItems = vi.spyOn(plan, "listItems");
  const writes = vi.spyOn(plan, "setPlanFields");

  // A drop: the dashboard computed the Target; the server writes what it is given, without reading the whole plan.
  // It reads no old values either: the dashboard keeps them for Undo.
  expect(await moveItem(deps, projectId, { issue: 22, start: "2026-10-06", target: "2026-10-07", estimate: 9 })).toEqual({ issue: 22, start: "2026-10-06", target: "2026-10-07", estimate: 9 });
  expect(writes).toHaveBeenCalledTimes(1);
  expect(writes).toHaveBeenLastCalledWith(repo, 1, 22, { start: "2026-10-06", target: "2026-10-07", estimate: 9 });
  expect(listItems).not.toHaveBeenCalled();
  expect(items.get(22)).toMatchObject({ start: "2026-10-06", target: "2026-10-07", estimate: 9 });

  // Undo writes the old values back: null clears the estimate, and the dates of an unscheduled task.
  await moveItem(deps, projectId, { issue: 22, start: "2026-10-04", target: "2026-10-04", estimate: null });
  expect(items.get(22)).toMatchObject({ start: "2026-10-04", target: "2026-10-04" });
  expect(items.get(22)?.estimate).toBeUndefined();
  await moveItem(deps, projectId, { issue: 21, start: null, target: null });
  expect(items.get(21)).toEqual({ status: "Shaping", size: "L" });

  await expect(moveItem(deps, projectId, { issue: 22, start: "2026-10-06", target: "2026-10-05" })).rejects.toThrow("#22: Target 2026-10-05 is before its Start 2026-10-06.");
  await expect(moveItem(deps, projectId, { issue: 22, start: "2026-10-06", target: "2026-10-06", estimate: -2 })).rejects.toThrow("An estimate is hours from 0 to 1000.");
  await expect(moveItem(deps, projectId, { issue: 99, start: "2026-10-06", target: "2026-10-06" })).rejects.toThrow("#99 could not be moved: it is not in the Project.");
  expect(writes).toHaveBeenCalledTimes(4);
});

test("saveArrange writes the tasks' Start and Target in one batch and reports a task GitHub refused", async () => {
  const items = await sizedPlan();
  for (const number of [23, 24, 25]) {
    github.issues.set(number, { number, title: `Issue ${number}`, url: `https://github.com/octo/sample/issues/${number}`, body: "", state: "open", labels: ["task"] });
    items.set(number, { status: "Shaping", size: "M" });
  }
  const listItems = vi.spyOn(plan, "listItems");
  const writes = vi.spyOn(plan, "setManyPlanFields");

  // The preview's placements go out together, not a request per task, and nothing reads the whole plan first.
  expect(
    await saveArrange(deps, projectId, [
      { issue: 23, start: "2026-10-05", target: "2026-10-05" },
      { issue: 24, start: "2026-10-05", target: "2026-10-06" },
    ]),
  ).toEqual({ saved: [23, 24], refused: [] });
  expect(writes).toHaveBeenCalledTimes(1);
  expect(writes).toHaveBeenLastCalledWith(repo, 1, [
    { issue: 23, fields: { start: "2026-10-05", target: "2026-10-05" } },
    { issue: 24, fields: { start: "2026-10-05", target: "2026-10-06" } },
  ]);
  expect(listItems).not.toHaveBeenCalled();
  expect(items.get(23)).toMatchObject({ start: "2026-10-05", target: "2026-10-05" });
  expect(items.get(24)).toMatchObject({ start: "2026-10-05", target: "2026-10-06" });

  // GitHub refuses #99, which is not in the Project: #25 is still written, and #99 is named with the reason.
  expect(
    await saveArrange(deps, projectId, [
      { issue: 25, start: "2026-10-07", target: "2026-10-07" },
      { issue: 99, start: "2026-10-07", target: "2026-10-07" },
    ]),
  ).toEqual({ saved: [25], refused: [{ issue: 99, reason: "it is not in the Project" }] });
  expect(items.get(25)).toMatchObject({ start: "2026-10-07", target: "2026-10-07" });

  // Dates are checked before anything is written.
  writes.mockClear();
  await expect(saveArrange(deps, projectId, [{ issue: 23, start: "2026-10-08", target: "2026-10-07" }])).rejects.toThrow("#23: Target 2026-10-07 is before its Start 2026-10-08.");
  await expect(saveArrange(deps, projectId, [])).rejects.toThrow("Give at least one task to arrange.");
  expect(writes).not.toHaveBeenCalled();
});

/** The repository's owner octo is an organization, so its plan lives on a Project the organization owns. */
const organization = () => plan.owners.set("octo", "Organization");
const organizationOwner = { login: "octo", type: "Organization" };
const storedNumber = async () => (await db.select({ number: projects.planProjectNumber }).from(projects).where(eq(projects.id, projectId)))[0]?.number;

/** An organization's plan set up through setup_plan, with an epic and a story created through the shaping tools. */
async function organizationPlan() {
  organization();
  const { project } = await setupPlan(deps, projectId);
  const epic = await createEpic(deps, projectId, { title: "Organizations", goal: "Plans for repositories an organization owns." });
  const story = await createStory(deps, projectId, { epic: epic.number, title: "Shaping tools", acceptance: ["Every tool works on the organization's Project"] });
  return { number: project.number, epic: epic.number, story: story.number };
}

test("setup_plan in an organization repository creates the Project under the organization and links it", async () => {
  organization();

  const result = await setupPlan(deps, projectId);

  expect(result).toMatchObject({
    created: true,
    project: { title: "sandbox plan", url: expect.stringContaining("https://github.com/orgs/octo/projects/"), owner: organizationOwner },
    missing_status_options: [],
  });
  expect(plan.plans.get("octo/sample")).toMatchObject({ login: "octo", project: { number: result.project.number, owner: "Organization" } });
  expect(await plan.listProjects("octo", repo)).toEqual([expect.objectContaining({ number: result.project.number, linked: true })]);
  expect(await storedNumber()).toBe(result.project.number);
  expect([...(plan.labels.get("octo/sample") ?? [])].sort()).toEqual(["epic", "story", "task"]);
});

test("setup_plan with use adopts an organization Project", async () => {
  organization();
  const roadmap = await plan.createProject("octo", { owner: "octo", name: "roadmap" }, "Roadmap");
  plan.plans.get("octo/roadmap")!.project.statusOptions = { Shaping: undefined, Ready: undefined, Running: undefined, "In review": undefined, Done: "opt-done" };

  const result = await setupPlan(deps, projectId, { use: roadmap.number });

  expect(result).toMatchObject({
    created: false,
    project: { number: roadmap.number, title: "Roadmap", url: `https://github.com/orgs/octo/projects/${roadmap.number}`, owner: organizationOwner },
    added_status_options: ["Shaping", "Ready", "Running", "In review"],
    missing_status_options: [],
  });
  expect(plan.plans.get("octo/sample")?.project.number).toBe(roadmap.number);
  expect(await storedNumber()).toBe(roadmap.number);
});

test("create_epic, create_story and create_task put the issues in Shaping on the organization's Project", async () => {
  const { number, epic, story } = await organizationPlan();
  const task = await createTask(deps, projectId, { story, title: "Test the tools", brief: "Run each shaping tool on an organization Project." });
  // The organization types the epic Task; its label keeps it an epic.
  plan.issueTypes.set(epic, "Task");

  const items = await plan.listItems("octo", number, repo);

  expect(items.map((i) => [i.number, i.kind, i.status, i.parent])).toEqual([
    [epic, "epic", "Shaping", undefined],
    [story, "story", "Shaping", epic],
    [task.number, "task", "Shaping", story],
  ]);
  expect([epic, story, task.number].map((n) => github.issues.get(n)?.labels)).toEqual([["epic"], ["story"], ["task"]]);
});

test("plan_issue, move_to_ready and move_to_shaping write Status on the organization's Project", async () => {
  const { story } = await organizationPlan();

  expect(await planIssue(deps, projectId, { issue: 11, story })).toMatchObject({ number: 11, kind: "task", status: "Shaping", parent: story });
  expect(await planIssue(deps, projectId, { issue: 12, story })).toMatchObject({ number: 12, status: "Shaping" });
  expect(await moveToReady(deps, projectId, [11, 12])).toEqual({ moved: [11, 12], status: "Ready" });
  expect([statusOf(11), statusOf(12)]).toEqual(["Ready", "Ready"]);
  expect(await moveToShaping(deps, projectId, [12])).toEqual({ moved: [12], status: "Shaping" });
  expect([statusOf(11), statusOf(12)]).toEqual(["Ready", "Shaping"]);
});

test("set_size writes Size on an organization Project in Flow mode and Size and Estimate in Timeline mode", async () => {
  const { story } = await organizationPlan();
  const task = (await createTask(deps, projectId, { story, title: "Size me", brief: "A task to size." })).number;
  const sized = () => {
    const { size, estimate } = plan.itemsOf(repo).get(task)!;
    return { size, estimate };
  };

  expect(await setSize(deps, projectId, { issue: task, size: "M" })).toEqual({ issue: task, size: { from: null, to: "M" } });
  expect(sized()).toEqual({ size: "M", estimate: undefined });

  // In Timeline mode setup_plan adds the Estimate field the Flow project did without.
  await timeline();
  expect(await setupPlan(deps, projectId)).toMatchObject({ added_estimate_fields: ["Estimate"] });
  expect(await setSize(deps, projectId, { issue: task, size: "L", estimate: 6 })).toEqual({ issue: task, size: { from: "M", to: "L" }, estimate: { from: null, to: 6 } });
  expect(sized()).toEqual({ size: "L", estimate: 6 });
});

/**
 * The sandbox project's plan on the user octo's Project, then GitHub moved octo/sample to the organization acme and
 * handoff moved the project: it uses acme/sample and has no plan. The old Project has #12, #13 and #11 in that
 * order, and its own Priority field.
 */
async function movedToOrganization() {
  github.issues.set(13, { number: 13, title: "Issue 13", url: "https://github.com/octo/sample/issues/13", body: "Body 13", state: "open" });
  const old = await plan.createProject("octo", repo, "sandbox plan");
  await plan.ensureEstimateFields("octo", old.number);
  plan.plans.get("octo/sample")!.project.priorityOptions = ["High", "Low"];
  for (const [issue, status] of [[12, "Ready"], [13, "Shaping"], [11, "Done"]] as const) await plan.setStatus(repo, old.number, issue, status, { add: true });
  await plan.setPlanFields(repo, old.number, 12, { size: "M", estimate: 5, start: "2026-10-06", target: "2026-10-07" });
  await plan.setPlanFields(repo, old.number, 11, { size: "S" });
  plan.itemsOf(repo).get(11)!.priority = "High";
  plan.owners.set("acme", "Organization");
  await db.update(projects).set({ repoOwner: "acme", planProjectNumber: null }).where(eq(projects.id, projectId));
  return old.number;
}
const acme = { owner: "acme", name: "sample" };

test("setup_plan with copy_from copies each item's Status and the mode's fields into the new Project in the old Project order, and lists the items with a Priority", async () => {
  const old = await movedToOrganization();
  await timeline();
  const copy = vi.spyOn(plan, "copyItems");

  const result = await setupPlan(deps, projectId, { copyFrom: { owner: "octo", number: old } });

  expect(result).toMatchObject({
    created: true,
    project: { title: "sandbox plan", owner: { login: "acme", type: "Organization" } },
    copied: { from: { owner: "octo", number: old }, items: [12, 13, 11], items_with_priority: [11], note: expect.stringContaining("Priority is not copied") },
  });
  expect(copy).toHaveBeenCalledWith(acme, { login: "octo", number: old }, { login: "acme", number: result.project.number }, ["size", "estimate", "start", "target"]);
  const items = await plan.listItems("acme", result.project.number, acme);
  expect(items.map((i) => [i.number, i.status, i.size, i.estimate, i.start, i.target])).toEqual([
    [12, "Ready", "M", 5, "2026-10-06", "2026-10-07"],
    [13, "Shaping", undefined, undefined, undefined, undefined],
    [11, "Done", "S", undefined, undefined, undefined],
  ]);
  // Priority stays on the old Project, which is left as it was.
  expect(items.map((i) => i.priority)).toEqual([undefined, undefined, undefined]);
  expect([...plan.itemsOf(repo).keys()]).toEqual([12, 13, 11]);
});

test("setup_plan with copy_from in a Flow project copies Status and Size only", async () => {
  const old = await movedToOrganization();
  const copy = vi.spyOn(plan, "copyItems");

  const result = await setupPlan(deps, projectId, { copyFrom: { owner: "octo", number: old } });

  expect(copy).toHaveBeenCalledWith(acme, { login: "octo", number: old }, { login: "acme", number: result.project.number }, ["size"]);
  expect((await plan.listItems("acme", result.project.number, acme)).map((i) => [i.number, i.status, i.size, i.estimate])).toEqual([
    [12, "Ready", "M", undefined],
    [13, "Shaping", undefined, undefined],
    [11, "Done", "S", undefined],
  ]);
  // The new plan cannot copy from itself.
  await expect(setupPlan(deps, projectId, { copyFrom: { owner: "acme", number: result.project.number } })).rejects.toThrow(/the plan.s own Project/);
});
