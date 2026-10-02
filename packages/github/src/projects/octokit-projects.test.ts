import { readFileSync } from "node:fs";
import { buildSchema, Kind, parse, validate } from "graphql";
import { expect, test } from "vitest";
import { fakeGraphql, GraphqlErrors } from "../testing/fake-fetch.ts";
import { OctokitProjects } from "./octokit-projects.ts";

const repo = { owner: "octo", name: "sample" };

/** The port over a fake fetch, without Octokit's one-second spacing of GraphQL calls. */
const port = (fetch: typeof globalThis.fetch) => OctokitProjects.withToken("t", { fetch, throttle: false });

/** An item of the PlanItems query whose content is an issue of `octo/sample`, with nothing set. */
function issueItem(number: number, over: Record<string, unknown> = {}, status: string | null = null) {
  return {
    status: status ? { __typename: "ProjectV2ItemFieldSingleSelectValue", name: status } : null,
    content: {
      __typename: "Issue",
      number,
      title: `Issue ${number}`,
      url: `https://github.com/octo/sample/issues/${number}`,
      state: "OPEN",
      updatedAt: "2026-10-01T10:00:00Z",
      repository: { name: "sample", owner: { login: "octo" } },
      labels: { nodes: [] },
      assignees: { nodes: [] },
      issueType: null,
      parent: null,
      subIssuesSummary: { total: 0, completed: 0 },
      blockedBy: { nodes: [] },
      closedByPullRequestsReferences: { nodes: [] },
      ...over,
    },
  };
}

const page = (nodes: unknown[], endCursor: string | null, hasNextPage: boolean) => ({
  user: { projectV2: { items: { pageInfo: { hasNextPage, endCursor }, nodes } } },
});

test("listItems reads every page of a Project and returns the repository's issues with status, kind, parent, sub-issue counts, open blockers and linked pull requests", async () => {
  const epic = issueItem(10, { title: "Project management", labels: { nodes: [{ name: "epic" }] }, subIssuesSummary: { total: 1, completed: 0 } }, "Shaping");
  const story = issueItem(11, { title: "Shaping with the assistant", parent: { number: 10, parent: null }, subIssuesSummary: { total: 2, completed: 1 } }, "Ready");
  const task = issueItem(
    12,
    {
      title: "Add the migration",
      state: "CLOSED",
      updatedAt: "2026-10-02T09:00:00Z",
      labels: { nodes: [{ name: "task" }, { name: "db" }] },
      assignees: { nodes: [{ login: "ann", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" }] },
      parent: { number: 11, parent: { number: 10, parent: null } },
      blockedBy: { nodes: [{ number: 3, state: "OPEN" }, { number: 4, state: "CLOSED" }] },
      closedByPullRequestsReferences: { nodes: [{ number: 40 }] },
    },
    "In review",
  );
  const unknownStatus = issueItem(13, { parent: { number: 11, parent: { number: 10, parent: null } } }, "Todo");
  const { fetch, operations } = fakeGraphql({
    PlanItems: (v) => (v.cursor ? page([task, unknownStatus], "c2", false) : page([epic, story], "c1", true)),
  });
  const projects = port(fetch);

  expect(await projects.listItems("octo", 3, repo)).toEqual([
    {
      number: 10,
      title: "Project management",
      url: "https://github.com/octo/sample/issues/10",
      state: "open",
      kind: "epic",
      status: "Shaping",
      parent: undefined,
      labels: ["epic"],
      assignees: [],
      subIssues: { total: 1, completed: 0 },
      blockedBy: [],
      blockers: [],
      position: 1,
      prNumbers: [],
      updatedAt: "2026-10-01T10:00:00Z",
    },
    {
      number: 11,
      title: "Shaping with the assistant",
      url: "https://github.com/octo/sample/issues/11",
      state: "open",
      kind: "story",
      status: "Ready",
      parent: 10,
      labels: [],
      assignees: [],
      subIssues: { total: 2, completed: 1 },
      blockedBy: [],
      blockers: [],
      position: 2,
      prNumbers: [],
      updatedAt: "2026-10-01T10:00:00Z",
    },
    {
      number: 12,
      title: "Add the migration",
      url: "https://github.com/octo/sample/issues/12",
      state: "closed",
      kind: "task",
      status: "In review",
      parent: 11,
      labels: ["task", "db"],
      assignees: [{ login: "ann", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" }],
      subIssues: { total: 0, completed: 0 },
      blockedBy: [3],
      blockers: [3, 4],
      position: 3,
      prNumbers: [40],
      updatedAt: "2026-10-02T09:00:00Z",
    },
    {
      number: 13,
      title: "Issue 13",
      url: "https://github.com/octo/sample/issues/13",
      state: "open",
      kind: "task",
      status: undefined,
      parent: 11,
      labels: [],
      assignees: [],
      subIssues: { total: 0, completed: 0 },
      blockedBy: [],
      blockers: [],
      position: 4,
      prNumbers: [],
      updatedAt: "2026-10-01T10:00:00Z",
    },
  ]);
  expect(operations.map((o) => o.variables)).toEqual([
    { login: "octo", number: 3 },
    { login: "octo", number: 3, cursor: "c1" },
  ]);
});

test("listItems skips draft issues, pull requests and issues of other repositories", async () => {
  const draft = { status: null, content: { __typename: "DraftIssue" } };
  const pull = { status: null, content: { __typename: "PullRequest" } };
  const redacted = { status: null, content: null };
  const elsewhere = issueItem(5, { repository: { name: "other", owner: { login: "octo" } } });
  const otherOwner = issueItem(6, { repository: { name: "sample", owner: { login: "someone" } } });
  const ours = issueItem(7, { repository: { name: "Sample", owner: { login: "Octo" } } });
  const { fetch } = fakeGraphql({ PlanItems: () => page([draft, pull, redacted, elsewhere, otherOwner, ours], null, false) });
  const projects = port(fetch);

  expect((await projects.listItems("octo", 3, repo)).map((i) => i.number)).toEqual([7]);
});

test("listItems numbers items by their position across pages", async () => {
  // GitHub returns items in Project order (POSITION ascending). A draft holds a place in that order too.
  const draft = { status: null, content: { __typename: "DraftIssue" } };
  const { fetch } = fakeGraphql({
    PlanItems: (v) => (v.cursor ? page([issueItem(7), issueItem(3)], "c2", false) : page([issueItem(9), draft, issueItem(4)], "c1", true)),
  });
  const projects = port(fetch);

  const items = await projects.listItems("octo", 3, repo);
  expect(items.map((i) => [i.number, i.position])).toEqual([
    [9, 1],
    [4, 3],
    [7, 4],
    [3, 5],
  ]);
});

test("listItems reads Start and Target as YYYY-MM-DD and an iteration's title, start and duration", async () => {
  const date = (value: string) => ({ __typename: "ProjectV2ItemFieldDateValue", date: value });
  const dated = { ...issueItem(20), start: date("2026-10-06"), target: date("2026-10-17") };
  const startOnly = { ...issueItem(21), start: date("2026-10-20"), target: null };
  const sprint = {
    ...issueItem(22),
    iteration: { __typename: "ProjectV2ItemFieldIterationValue", title: "Sprint 3", startDate: "2026-10-05", duration: 14 },
  };
  // A field named Start that is not a date field answers with another value type: handoff reads no date from it.
  const textStart = { ...issueItem(23), start: { __typename: "ProjectV2ItemFieldTextValue" } };
  const { fetch } = fakeGraphql({ PlanItems: () => page([dated, startOnly, sprint, textStart], null, false) });
  const projects = port(fetch);

  const items = await projects.listItems("octo", 3, repo);
  expect(items.map((i) => ({ number: i.number, start: i.start, target: i.target, iteration: i.iteration }))).toEqual([
    { number: 20, start: "2026-10-06", target: "2026-10-17", iteration: undefined },
    { number: 21, start: "2026-10-20", target: undefined, iteration: undefined },
    { number: 22, start: undefined, target: undefined, iteration: { title: "Sprint 3", startDate: "2026-10-05", duration: 14 } },
    { number: 23, start: undefined, target: undefined, iteration: undefined },
  ]);
});

test("listItems reads Size as S, M or L and Estimate in hours, and another Size option or an Estimate of 0 as none", async () => {
  const size = (name: string) => ({ __typename: "ProjectV2ItemFieldSingleSelectValue", name });
  const estimate = (number: number) => ({ __typename: "ProjectV2ItemFieldNumberValue", number });
  const { fetch } = fakeGraphql({
    PlanItems: () =>
      page(
        [
          { ...issueItem(50), size: size("S"), estimate: null },
          { ...issueItem(51), size: size("M"), estimate: estimate(10.5) },
          { ...issueItem(52), size: size("L"), estimate: estimate(0) },
          // Project #1's own Size options are not handoff's sizes.
          { ...issueItem(53), size: size("🦑 Large"), estimate: estimate(-2) },
          { ...issueItem(54), size: null, estimate: estimate(3) },
          // Fields named Size and Estimate of another type answer with another value type.
          { ...issueItem(55), size: { __typename: "ProjectV2ItemFieldTextValue" }, estimate: { __typename: "ProjectV2ItemFieldTextValue" } },
        ],
        null,
        false,
      ),
  });
  const projects = port(fetch);

  expect((await projects.listItems("octo", 3, repo)).map((i) => [i.number, i.size, i.estimate])).toEqual([
    [50, "S", undefined],
    [51, "M", 10.5],
    [52, "L", undefined],
    [53, undefined, undefined],
    [54, undefined, 3],
    [55, undefined, undefined],
  ]);
});

const statusField = {
  __typename: "ProjectV2SingleSelectField",
  id: "F_status",
  options: [
    { id: "o_shaping", name: "Shaping" },
    { id: "o_ready", name: "Ready" },
    { id: "o_running", name: "Running" },
    { id: "o_review", name: "In review" },
    { id: "o_done", name: "Done" },
  ],
};
/** A Project field as `field(name:)` answers it: a date field by default. */
const projectField = (id: string, dataType = "DATE") => ({ __typename: "ProjectV2Field", id, dataType });
/** A Project with handoff's Status options and, unless `dates` is false, the Start and Target date fields. */
const planProject = (number: number, ownerId = "U_octo", dates = true) => ({
  id: `PVT_${number}`,
  number,
  owner: { id: ownerId },
  field: statusField,
  start: dates ? projectField("F_start") : null,
  target: dates ? projectField("F_target") : null,
});

/** The IssuePlan answer for an issue that is an item of the given Projects. */
function issuePlan(number: number, items: { id: string; project: ReturnType<typeof planProject> & Record<string, unknown>; status?: string }[], over: Record<string, unknown> = {}) {
  return {
    repository: {
      owner: { id: "U_octo" },
      issue: {
        id: `I_${number}`,
        number,
        title: `Issue ${number}`,
        body: "",
        labels: { nodes: [] },
        issueType: null,
        parent: null,
        projectItems: { nodes: items.map((i) => ({ id: i.id, project: i.project, status: i.status ? { __typename: "ProjectV2ItemFieldSingleSelectValue", name: i.status } : null })) },
        ...over,
      },
    },
  };
}

test("setStatus finds the issue's item and sets the Status option by id, and reports not-in-project when the issue is not an item", async () => {
  const { fetch, operations } = fakeGraphql({
    IssuePlan: (v) =>
      v.number === 12
        ? // The issue is in another owner's Project 3 too, and in the user's Project 2: neither is the plan.
          issuePlan(12, [
            { id: "PVTI_other", project: planProject(3, "O_someone") },
            { id: "PVTI_2", project: planProject(2) },
            { id: "PVTI_3", project: planProject(3), status: "Shaping" },
          ])
        : issuePlan(13, [{ id: "PVTI_2", project: planProject(2) }]),
    SetPlanStatus: () => ({ updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_3" } } }),
  });
  const projects = port(fetch);

  expect(await projects.setStatus(repo, 3, 12, "Ready")).toBe("set");
  expect(operations.at(-1)).toEqual({ operation: "SetPlanStatus", variables: { projectId: "PVT_3", itemId: "PVTI_3", fieldId: "F_status", optionId: "o_ready" } });

  expect(await projects.setStatus(repo, 3, 13, "Ready")).toBe("not-in-project");
  expect(operations.at(-1)).toEqual({ operation: "IssuePlan", variables: { owner: "octo", name: "sample", number: 13 } });
});

test("setStatus with add adds the issue to the Project first", async () => {
  const { fetch, operations } = fakeGraphql({
    IssuePlan: () => issuePlan(12, []),
    PlanProject: () => ({ user: { projectV2: { ...planProject(3), url: "https://github.com/users/octo/projects/3", title: "sample plan" } } }),
    AddPlanItem: () => ({ addProjectV2ItemById: { item: { id: "PVTI_new" } } }),
    SetPlanStatus: () => ({ updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_new" } } }),
  });
  const projects = port(fetch);

  expect(await projects.setStatus(repo, 3, 12, "Shaping", { add: true })).toBe("set");
  expect(operations).toEqual([
    { operation: "IssuePlan", variables: { owner: "octo", name: "sample", number: 12 } },
    { operation: "PlanProject", variables: { login: "octo", number: 3 } },
    { operation: "AddPlanItem", variables: { projectId: "PVT_3", contentId: "I_12" } },
    { operation: "SetPlanStatus", variables: { projectId: "PVT_3", itemId: "PVTI_new", fieldId: "F_status", optionId: "o_shaping" } },
  ]);
});

test("createProject creates a user Project, renames the Status options keeping Done, adds the Start and Target date fields, links the repository and returns the ids", async () => {
  const defaults = {
    __typename: "ProjectV2SingleSelectField",
    id: "F_status",
    options: [
      { id: "o_todo", name: "Todo", color: "GREEN", description: "This item hasn't been started" },
      { id: "o_progress", name: "In Progress", color: "YELLOW", description: "This is actively being worked on" },
      { id: "o_done", name: "Done", color: "PURPLE", description: "This has been completed" },
    ],
  };
  const renamed = {
    __typename: "ProjectV2SingleSelectField",
    id: "F_status",
    options: [
      { id: "o_s", name: "Shaping" },
      { id: "o_r", name: "Ready" },
      { id: "o_run", name: "Running" },
      { id: "o_rev", name: "In review" },
      { id: "o_done", name: "Done" },
    ],
  };
  const { fetch, operations } = fakeGraphql({
    PlanOwnerIds: () => ({ user: { id: "U_octo" }, repository: { id: "R_sample" } }),
    CreatePlanProject: () => ({ createProjectV2: { projectV2: { id: "PVT_9", number: 9, url: "https://github.com/users/octo/projects/9", title: "sample plan", field: defaults } } }),
    SetStatusOptions: () => ({ updateProjectV2Field: { projectV2Field: renamed } }),
    CreatePlanDateField: (v) => ({ createProjectV2Field: { projectV2Field: { __typename: "ProjectV2Field", id: `F_${String(v.name).toLowerCase()}`, dataType: "DATE" } } }),
    LinkPlanRepository: () => ({ linkProjectV2ToRepository: { repository: { id: "R_sample" } } }),
  });
  const projects = port(fetch);

  expect(await projects.createProject("octo", repo, "sample plan")).toEqual({
    number: 9,
    url: "https://github.com/users/octo/projects/9",
    title: "sample plan",
    statusOptions: { Shaping: "o_s", Ready: "o_r", Running: "o_run", "In review": "o_rev", Done: "o_done" },
    dateFields: { start: "F_start", target: "F_target" },
  });
  expect(operations.map((o) => o.operation)).toEqual(["PlanOwnerIds", "CreatePlanProject", "SetStatusOptions", "CreatePlanDateField", "CreatePlanDateField", "LinkPlanRepository"]);
  expect(operations.filter((o) => o.operation === "CreatePlanDateField").map((o) => o.variables)).toEqual([
    { projectId: "PVT_9", name: "Start" },
    { projectId: "PVT_9", name: "Target" },
  ]);
  expect(operations[0]!.variables).toEqual({ login: "octo", owner: "octo", name: "sample" });
  expect(operations[1]!.variables).toEqual({ ownerId: "U_octo", title: "sample plan" });
  const options = (operations[2]!.variables.options as { id?: string; name: string; color: string; description: string }[]).map(({ id, name, color, description }) => ({ id, name, color, description }));
  expect(operations[2]!.variables.fieldId).toBe("F_status");
  expect(options.map((o) => o.name)).toEqual(["Shaping", "Ready", "Running", "In review", "Done"]);
  // Done keeps its option id, colour and description, so GitHub's "Item closed" workflow still finds it.
  expect(options[4]).toEqual({ id: "o_done", name: "Done", color: "PURPLE", description: "This has been completed" });
  expect(options.slice(0, 4).every((o) => o.id === undefined)).toBe(true);
  expect(operations.at(-1)!.variables).toEqual({ projectId: "PVT_9", repositoryId: "R_sample" });
});

test("createIssue sends the parent, the labels and the blockers, and leaves the issue in Shaping", async () => {
  const { fetch, operations } = fakeGraphql({
    IssueCreateRefs: () => ({
      repository: {
        id: "R_sample",
        labels: { nodes: [{ id: "L_epic", name: "epic" }, { id: "L_task", name: "task" }, { id: "L_db", name: "db" }] },
        parent: { id: "I_11" },
      },
    }),
    IssueNodeId: (v) => ({ repository: { issue: { id: `I_${v.number}` } } }),
    CreatePlanIssue: () => ({ createIssue: { issue: { id: "I_20", number: 20, url: "https://github.com/octo/sample/issues/20" } } }),
    AddPlanBlocker: (v) => ({ addBlockedBy: { issue: { id: v.issueId } } }),
    // GitHub may already have added the sub-issue to its parent's Project; here it has not.
    IssuePlan: () => issuePlan(20, []),
    PlanProject: () => ({ user: { projectV2: { ...planProject(3), url: "u", title: "t" } } }),
    AddPlanItem: () => ({ addProjectV2ItemById: { item: { id: "PVTI_20" } } }),
    SetPlanStatus: () => ({ updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_20" } } }),
  });
  const projects = port(fetch);

  const created = await projects.createIssue(repo, { project: 3, title: "Add the migration", body: "## Goal\nA column.", labels: ["task", "db"], parent: 11, blockedBy: [3, 4] });

  expect(created).toEqual({ number: 20, url: "https://github.com/octo/sample/issues/20" });
  const sent = (name: string) => operations.filter((o) => o.operation === name).map((o) => o.variables);
  expect(sent("IssueCreateRefs")).toEqual([{ owner: "octo", name: "sample", parent: 11, withParent: true }]);
  expect(sent("CreatePlanIssue")).toEqual([
    { repositoryId: "R_sample", title: "Add the migration", body: "## Goal\nA column.", labelIds: ["L_task", "L_db"], parentIssueId: "I_11" },
  ]);
  expect(sent("AddPlanBlocker")).toEqual([
    { issueId: "I_20", blockingIssueId: "I_3" },
    { issueId: "I_20", blockingIssueId: "I_4" },
  ]);
  expect(sent("SetPlanStatus")).toEqual([{ projectId: "PVT_3", itemId: "PVTI_20", fieldId: "F_status", optionId: "o_shaping" }]);
  // The status is written last, after every link is in place.
  expect(operations.at(-1)!.operation).toBe("SetPlanStatus");
});

test("createIssue sets Start and Target after adding the item", async () => {
  let added = false;
  const { fetch, operations } = fakeGraphql({
    IssueCreateRefs: () => ({ repository: { id: "R_sample", labels: { nodes: [{ id: "L_task", name: "task" }] } } }),
    CreatePlanIssue: () => ({ createIssue: { issue: { id: "I_20", number: 20, url: "https://github.com/octo/sample/issues/20" } } }),
    IssuePlan: () => issuePlan(20, added ? [{ id: "PVTI_20", project: planProject(3), status: "Shaping" }] : []),
    PlanProject: () => ({ user: { projectV2: { ...planProject(3), url: "u", title: "t" } } }),
    AddPlanItem: () => {
      added = true;
      return { addProjectV2ItemById: { item: { id: "PVTI_20" } } };
    },
    SetPlanStatus: () => ({ updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_20" } } }),
    SetPlanFields: () => ({ start: { projectV2Item: { id: "PVTI_20" } }, target: { projectV2Item: { id: "PVTI_20" } } }),
  });
  const projects = port(fetch);

  await projects.createIssue(repo, { project: 3, title: "Add the migration", body: "A column.", labels: ["task"], start: "2026-10-06", target: "2026-10-09" });

  expect(operations.map((o) => o.operation).slice(-2)).toEqual(["IssuePlan", "SetPlanFields"]);
  expect(operations.at(-1)!.variables).toEqual({ projectId: "PVT_3", itemId: "PVTI_20", startField: "F_start", startValue: "2026-10-06", targetField: "F_target", targetValue: "2026-10-09" });
  expect(operations.findIndex((o) => o.operation === "SetPlanStatus")).toBeLessThan(operations.findIndex((o) => o.operation === "SetPlanFields"));
});

test("createIssue refuses a label the repository does not have, before creating anything", async () => {
  const { fetch, operations } = fakeGraphql({
    IssueCreateRefs: () => ({ repository: { id: "R_sample", labels: { nodes: [{ id: "L_task", name: "task" }] } } }),
  });
  const projects = port(fetch);

  await expect(projects.createIssue(repo, { project: 3, title: "T", body: "B", labels: ["story"] })).rejects.toThrow('label "story"');
  expect(operations.map((o) => o.operation)).toEqual(["IssueCreateRefs"]);
});

/** A Status field with the named options, ids o_<index>. */
const statusOptions = (...names: string[]) => ({
  __typename: "ProjectV2SingleSelectField",
  id: "F_status",
  options: names.map((name, i) => ({ id: `o_${i}`, name, color: "GRAY", description: "" })),
});

/** A user Project as the PlanProjects and PlanProjectSetup queries return it. */
const userProject = (number: number, title: string, field: unknown, repositories: { name: string; owner: string }[] = []) => ({
  id: `PVT_${number}`,
  number,
  title,
  url: `https://github.com/users/octo/projects/${number}`,
  closed: false,
  field,
  repositories: { nodes: repositories.map((r) => ({ id: `R_${r.name}`, name: r.name, owner: { login: r.owner } })) },
});

test("listProjects lists the user's open Projects, those linked to the repository first, with the Status options each lacks", async () => {
  const { fetch, operations } = fakeGraphql({
    PlanProjects: () => ({
      user: {
        projectsV2: {
          nodes: [
            userProject(3, "gqlPrune Roadmap", statusOptions("Todo", "In Progress", "Done"), [{ name: "gqlPrune", owner: "octo" }]),
            { ...userProject(4, "Old", statusOptions("Done")), closed: true },
            userProject(2, "sample plan", statusOptions("Shaping", "Ready", "Running", "In review", "Done"), [{ name: "Sample", owner: "Octo" }]),
            userProject(1, "Untitled", null),
          ],
        },
      },
    }),
  });
  const projects = port(fetch);

  expect(await projects.listProjects("octo", repo)).toEqual([
    { number: 2, title: "sample plan", url: "https://github.com/users/octo/projects/2", linked: true, missingStatusOptions: [] },
    { number: 3, title: "gqlPrune Roadmap", url: "https://github.com/users/octo/projects/3", linked: false, missingStatusOptions: ["Shaping", "Ready", "Running", "In review"] },
    { number: 1, title: "Untitled", url: "https://github.com/users/octo/projects/1", linked: false, missingStatusOptions: ["Shaping", "Ready", "Running", "In review", "Done"] },
  ]);
  expect(operations.map((o) => [o.operation, o.variables])).toEqual([["PlanProjects", { login: "octo" }]]);
});

test("adoptProject links the repository and renames or adds handoff's Status options, keeping the other options and their ids", async () => {
  const current = statusOptions("🆕 New", "📋 Backlog", "✅ ready", "🏗 In progress", "👀 In review", "Done");
  const { fetch, operations } = fakeGraphql({
    PlanProjectSetup: () => ({ user: { projectV2: userProject(1, "Untitled", current) } }),
    PlanOwnerIds: () => ({ user: { id: "U_octo" }, repository: { id: "R_sample" } }),
    SetStatusOptions: (v) => ({
      updateProjectV2Field: {
        projectV2Field: { __typename: "ProjectV2SingleSelectField", id: "F_status", options: (v.options as { id?: string; name: string }[]).map((o, i) => ({ id: o.id ?? `new_${i}`, name: o.name })) },
      },
    }),
    LinkPlanRepository: () => ({ linkProjectV2ToRepository: { repository: { id: "R_sample" } } }),
  });
  const projects = port(fetch);

  const adopted = await projects.adoptProject("octo", 1, repo);

  const sent = (name: string) => operations.filter((o) => o.operation === name).map((o) => o.variables);
  expect(sent("SetStatusOptions")).toEqual([
    {
      fieldId: "F_status",
      options: [
        { name: "Shaping", color: "GRAY", description: "Being shaped; not ready to build yet" },
        { id: "o_2", name: "Ready", color: "GRAY", description: "" },
        { name: "Running", color: "YELLOW", description: "A handoff run is working on it" },
        { id: "o_4", name: "In review", color: "GRAY", description: "" },
        { id: "o_5", name: "Done", color: "GRAY", description: "" },
        { id: "o_0", name: "🆕 New", color: "GRAY", description: "" },
        { id: "o_1", name: "📋 Backlog", color: "GRAY", description: "" },
        { id: "o_3", name: "🏗 In progress", color: "GRAY", description: "" },
      ],
    },
  ]);
  expect(sent("LinkPlanRepository")).toEqual([{ projectId: "PVT_1", repositoryId: "R_sample" }]);
  expect(adopted).toEqual({
    project: {
      number: 1,
      url: "https://github.com/users/octo/projects/1",
      title: "Untitled",
      statusOptions: { Shaping: "new_0", Ready: "o_2", Running: "new_2", "In review": "o_4", Done: "o_5" },
      // The Project has no date fields yet; setup_plan adds them with ensureDateFields.
      dateFields: { start: undefined, target: undefined },
    },
    renamed: [
      { from: "✅ ready", to: "Ready" },
      { from: "👀 In review", to: "In review" },
    ],
    added: ["Shaping", "Running"],
  });
});

test("adoptProject leaves a Project that already has handoff's options and is linked alone", async () => {
  const { fetch, operations } = fakeGraphql({
    PlanProjectSetup: () => ({
      user: {
        projectV2: {
          ...userProject(2, "sample plan", statusOptions("Shaping", "Ready", "Running", "In review", "Done", "Parked"), [{ name: "sample", owner: "octo" }]),
          start: projectField("F_start"),
          target: projectField("F_target"),
        },
      },
    }),
  });
  const projects = port(fetch);

  expect(await projects.adoptProject("octo", 2, repo)).toMatchObject({
    project: { number: 2, statusOptions: { Shaping: "o_0", Done: "o_4" }, dateFields: { start: "F_start", target: "F_target" } },
    renamed: [],
    added: [],
  });
  expect(operations.map((o) => o.operation)).toEqual(["PlanProjectSetup"]);
});

test("addIssue labels an existing issue, makes it a sub-issue of the parent and adds it to the Project in Shaping", async () => {
  const { fetch, operations } = fakeGraphql({
    IssueCreateRefs: () => ({ repository: { id: "R_sample", labels: { nodes: [{ id: "L_task", name: "task" }] }, parent: { id: "I_11" } } }),
    IssueNodeId: (v) => ({ repository: { issue: { id: `I_${v.number}` } } }),
    AddPlanLabels: () => ({ addLabelsToLabelable: { clientMutationId: null } }),
    AddPlanSubIssue: () => ({ addSubIssue: { issue: { id: "I_11" } } }),
    IssuePlan: () => issuePlan(30, []),
    PlanProject: () => ({ user: { projectV2: { ...planProject(3), url: "u", title: "t" } } }),
    AddPlanItem: () => ({ addProjectV2ItemById: { item: { id: "PVTI_30" } } }),
    SetPlanStatus: () => ({ updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_30" } } }),
  });
  const projects = port(fetch);

  await projects.addIssue(repo, { project: 3, issue: 30, labels: ["task"], parent: 11 });

  const sent = (name: string) => operations.filter((o) => o.operation === name).map((o) => o.variables);
  expect(sent("AddPlanLabels")).toEqual([{ labelableId: "I_30", labelIds: ["L_task"] }]);
  expect(sent("AddPlanSubIssue")).toEqual([{ issueId: "I_11", subIssueId: "I_30" }]);
  expect(sent("SetPlanStatus")).toEqual([{ projectId: "PVT_3", itemId: "PVTI_30", fieldId: "F_status", optionId: "o_shaping" }]);
  expect(operations.at(-1)!.operation).toBe("SetPlanStatus");
});

test("lineage walks parent then grandparent with their bodies and kinds", async () => {
  const ancestor = (number: number, over: Record<string, unknown>) => ({ number, title: `Issue ${number}`, body: "", labels: { nodes: [] }, issueType: null, parent: null, ...over });
  const { fetch, operations } = fakeGraphql({
    IssuePlan: (v) =>
      v.number === 12
        ? issuePlan(12, [], {
            parent: ancestor(11, {
              title: "Shaping with the assistant",
              body: "## Acceptance criteria\n- [ ] cards",
              labels: { nodes: [{ name: "story" }] },
              // The grandparent has no kind label and no parent of its own: by depth it is the epic.
              parent: ancestor(10, { title: "Project management", body: "## Goal\nA plan.", parent: null }),
            }),
          })
        : issuePlan(30, []),
  });
  const projects = port(fetch);

  expect(await projects.lineage(repo, 12)).toEqual([
    { number: 11, title: "Shaping with the assistant", body: "## Acceptance criteria\n- [ ] cards", kind: "story" },
    { number: 10, title: "Project management", body: "## Goal\nA plan.", kind: "epic" },
  ]);
  expect(operations[0]!.variables).toEqual({ owner: "octo", name: "sample", number: 12 });
  expect(await projects.lineage(repo, 30)).toEqual([]);
});

test("getProject reads a user's Project with its Status option ids and date field ids, and is undefined when GitHub cannot resolve it", async () => {
  const { fetch } = fakeGraphql({
    PlanProject: (v) =>
      v.number === 3
        ? { user: { projectV2: { ...planProject(3), url: "https://github.com/users/octo/projects/3", title: "sample plan" } } }
        : // GitHub answers a Project number it cannot resolve with a NOT_FOUND error next to the null.
          new GraphqlErrors({ user: { projectV2: null } }, [{ type: "NOT_FOUND", path: ["user", "projectV2"], message: `Could not resolve to a ProjectV2 with the number ${v.number}.` }]),
  });
  const projects = port(fetch);

  expect(await projects.getProject("octo", 3)).toEqual({
    number: 3,
    url: "https://github.com/users/octo/projects/3",
    title: "sample plan",
    statusOptions: { Shaping: "o_shaping", Ready: "o_ready", Running: "o_running", "In review": "o_review", Done: "o_done" },
    dateFields: { start: "F_start", target: "F_target" },
    estimateFields: { size: undefined, estimate: undefined },
  });
  expect(await projects.getProject("octo", 99)).toBeUndefined();
});

test("listItems reads the Priority option and getProject returns the Priority options in field order", async () => {
  const priority = (name: string) => ({ __typename: "ProjectV2ItemFieldSingleSelectValue", name });
  const medium = { ...issueItem(30), priority: priority("Medium") };
  const high = { ...issueItem(31), priority: priority("High") };
  const none = { ...issueItem(32), priority: null };
  // A field named Priority that is not a single select answers with another value type: handoff reads no priority from it.
  const text = { ...issueItem(33), priority: { __typename: "ProjectV2ItemFieldTextValue" } };
  const { fetch } = fakeGraphql({
    PlanItems: () => page([medium, high, none, text], null, false),
    // The options as Project #3 lists them live: the first is the highest.
    PlanProject: () => ({
      user: {
        projectV2: {
          ...planProject(3),
          url: "https://github.com/users/octo/projects/3",
          title: "sample plan",
          priority: {
            __typename: "ProjectV2SingleSelectField",
            id: "F_priority",
            options: [
              { id: "o_high", name: "High" },
              { id: "o_medium", name: "Medium" },
              { id: "o_low", name: "Low" },
            ],
          },
        },
      },
    }),
  });
  const projects = port(fetch);

  expect((await projects.listItems("octo", 3, repo)).map((i) => [i.number, i.priority])).toEqual([
    [30, "Medium"],
    [31, "High"],
    [32, undefined],
    [33, undefined],
  ]);
  expect((await projects.getProject("octo", 3))?.priorityOptions).toEqual(["High", "Medium", "Low"]);
});

/** How GitHub answers `field(name: "Start")` and `field(name: "Target")` on a Project without those fields: the data plus a NOT_FOUND per field. */
const missingDateFields = (path: string[]) =>
  ["start", "target"].map((alias) => ({
    type: "NOT_FOUND",
    path: [...path, alias],
    message: `Could not resolve to a Unions::ProjectV2FieldConfiguration with the name ${alias === "start" ? "Start" : "Target"}`,
  }));

test("a Project without Start and Target fields is still read, with no date field ids", async () => {
  const project = { ...planProject(5, "U_octo", false), url: "https://github.com/users/octo/projects/5", title: "older plan", closed: false, repositories: { nodes: [] } };
  const { fetch } = fakeGraphql({
    PlanProject: () => new GraphqlErrors({ user: { projectV2: project } }, missingDateFields(["user", "projectV2"])),
    PlanProjects: () => new GraphqlErrors({ user: { projectsV2: { nodes: [project] } } }, missingDateFields(["user", "projectsV2", "nodes", "0"])),
  });
  const projects = port(fetch);

  expect(await projects.getProject("octo", 5)).toMatchObject({ number: 5, title: "older plan", dateFields: { start: undefined, target: undefined } });
  expect((await projects.listProjects("octo", repo)).map((p) => p.number)).toEqual([5]);
});

/** How GitHub answers `field(name: "Size")` and `field(name: "Estimate")` on a Project without those fields: a NOT_FOUND per field next to the data. */
const missingEstimateFields = (path: string[]) =>
  [
    ["size", "Size"],
    ["estimate", "Estimate"],
  ].map(([alias, name]) => ({ type: "NOT_FOUND", path: [...path, alias!], message: `Could not resolve to a Unions::ProjectV2FieldConfiguration with the name ${name}` }));

/** A Size single select field with the named options, ids o_<name>, each with a colour and description. */
const sizeField = (...names: string[]) => ({
  __typename: "ProjectV2SingleSelectField",
  id: "F_size",
  options: names.map((name) => ({ id: `o_${name}`, name, color: "GRAY", description: "" })),
});

test("a Project without Size and Estimate fields is read with no estimate field ids", async () => {
  const bare = { ...planProject(5), url: "https://github.com/users/octo/projects/5", title: "todooverkill plan", closed: false, repositories: { nodes: [] } };
  const sized = { ...planProject(1), url: "https://github.com/users/octo/projects/1", title: "sized", size: sizeField("🐋 X-Large", "S", "M", "L"), estimate: projectField("F_estimate", "NUMBER") };
  const { fetch } = fakeGraphql({
    PlanProject: (v) => (v.number === 5 ? new GraphqlErrors({ user: { projectV2: bare } }, missingEstimateFields(["user", "projectV2"])) : { user: { projectV2: sized } }),
    PlanProjects: () => new GraphqlErrors({ user: { projectsV2: { nodes: [bare] } } }, missingEstimateFields(["user", "projectsV2", "nodes", "0"])),
  });
  const projects = port(fetch);

  expect(await projects.getProject("octo", 5)).toMatchObject({ number: 5, dateFields: { start: "F_start", target: "F_target" }, estimateFields: { size: undefined, estimate: undefined } });
  expect((await projects.listProjects("octo", repo)).map((p) => p.number)).toEqual([5]);
  expect((await projects.getProject("octo", 1))?.estimateFields).toEqual({ size: { id: "F_size", options: { S: "o_S", M: "o_M", L: "o_L" } }, estimate: "F_estimate" });
});

test("a Project without a Priority field gives every item no priority", async () => {
  // Project #5 live: no Start, Target or Priority field. Each `field(name:)` lookup answers NOT_FOUND next to the data; `fieldValueByName` answers null without an error.
  const project = { ...planProject(5, "U_octo", false), url: "https://github.com/users/octo/projects/5", title: "older plan", priority: null };
  const missingPriority = {
    type: "NOT_FOUND",
    path: ["user", "projectV2", "priority"],
    message: "Could not resolve to a Unions::ProjectV2FieldConfiguration with the name Priority",
  };
  const { fetch } = fakeGraphql({
    PlanProject: () => new GraphqlErrors({ user: { projectV2: project } }, [...missingDateFields(["user", "projectV2"]), missingPriority]),
    PlanItems: () => page([{ ...issueItem(40), priority: null }, { ...issueItem(41), priority: null }], null, false),
  });
  const projects = port(fetch);

  expect(await projects.getProject("octo", 5)).toMatchObject({ number: 5, title: "older plan", priorityOptions: undefined });
  expect((await projects.listItems("octo", 5, repo)).map((i) => [i.number, i.priority])).toEqual([
    [40, undefined],
    [41, undefined],
  ]);
});

test("getStatus reads the issue's Status in the Project, and is undefined when the issue is not an item", async () => {
  const { fetch } = fakeGraphql({
    IssuePlan: (v) => (v.number === 12 ? issuePlan(12, [{ id: "PVTI_3", project: planProject(3), status: "Running" }]) : issuePlan(13, [{ id: "PVTI_2", project: planProject(2), status: "Ready" }])),
  });
  const projects = port(fetch);

  expect(await projects.getStatus(repo, 3, 12)).toBe("Running");
  expect(await projects.getStatus(repo, 3, 13)).toBeUndefined();
});

test("ensureLabels creates only the kind labels the repository is missing", async () => {
  const { fetch, operations } = fakeGraphql({
    IssueCreateRefs: () => ({ repository: { id: "R_sample", labels: { nodes: [{ id: "L_bug", name: "bug" }, { id: "L_epic", name: "Epic" }] } } }),
    CreatePlanLabel: (v) => ({ createLabel: { label: { id: `L_${v.name}` } } }),
  });
  const projects = port(fetch);

  await projects.ensureLabels(repo);
  const created = operations.filter((o) => o.operation === "CreatePlanLabel").map((o) => o.variables);
  expect(created.map((v) => v.name)).toEqual(["story", "task"]);
  expect(created.every((v) => v.repositoryId === "R_sample" && /^[0-9a-f]{6}$/.test(String(v.color)) && String(v.description).length > 0)).toBe(true);
});

test("setStatus reports no-option when the Project's Status has no such option", async () => {
  const todoOnly = { ...planProject(3), field: { ...statusField, options: [{ id: "o_todo", name: "Todo" }] } };
  const { fetch, operations } = fakeGraphql({ IssuePlan: () => issuePlan(12, [{ id: "PVTI_3", project: todoOnly }]) });
  const projects = port(fetch);

  expect(await projects.setStatus(repo, 3, 12, "Ready")).toBe("no-option");
  expect(operations.map((o) => o.operation)).toEqual(["IssuePlan"]);
});

test("ensureDateFields creates Start and Target once and returns the ids", async () => {
  let project: Record<string, unknown> = { ...planProject(3), url: "u", title: "t", start: null, target: projectField("F_target") };
  const { fetch, operations } = fakeGraphql({
    PlanProject: () => ({ user: { projectV2: project } }),
    CreatePlanDateField: (v) => {
      project = { ...project, start: projectField("F_start") };
      return { createProjectV2Field: { projectV2Field: { __typename: "ProjectV2Field", id: "F_start", dataType: "DATE", name: v.name } } };
    },
  });
  const projects = port(fetch);

  expect(await projects.ensureDateFields("octo", 3)).toEqual({ start: "F_start", target: "F_target" });
  expect(operations.map((o) => [o.operation, o.variables])).toEqual([
    ["PlanProject", { login: "octo", number: 3 }],
    ["CreatePlanDateField", { projectId: "PVT_3", name: "Start" }],
  ]);

  operations.length = 0;
  expect(await projects.ensureDateFields("octo", 3)).toEqual({ start: "F_start", target: "F_target" });
  expect(operations.map((o) => o.operation)).toEqual(["PlanProject"]);

  // A field named Start that is not a date field blocks a date field of that name; handoff says so and creates nothing.
  project = { ...project, start: projectField("F_text", "TEXT"), target: null };
  operations.length = 0;
  await expect(projects.ensureDateFields("octo", 3)).rejects.toThrow(/Start field that is not a date field/);
  expect(operations.map((o) => o.operation)).toEqual(["PlanProject"]);
});

test("setDates writes a date, clears one with null, and reports no-field on a Project without the fields", async () => {
  const { fetch, operations } = fakeGraphql({
    IssuePlan: (v) =>
      v.number === 12
        ? issuePlan(12, [{ id: "PVTI_3", project: planProject(3) }])
        : v.number === 13
          ? issuePlan(13, [{ id: "PVTI_2", project: planProject(2) }])
          : // A Project with a text field named Start and no Target field.
            issuePlan(14, [{ id: "PVTI_14", project: { ...planProject(3, "U_octo", false), start: projectField("F_text", "TEXT") } }]),
    SetPlanFields: () => ({ start: { projectV2Item: { id: "PVTI_3" } } }),
  });
  const projects = port(fetch);

  expect(await projects.setDates(repo, 3, 12, { start: "2026-10-06", target: null })).toBe("set");
  expect(operations.map((o) => [o.operation, o.variables])).toEqual([
    ["IssuePlan", { owner: "octo", name: "sample", number: 12 }],
    ["SetPlanFields", { projectId: "PVT_3", itemId: "PVTI_3", startField: "F_start", startValue: "2026-10-06", targetField: "F_target" }],
  ]);

  // Only the dates given change: target alone leaves Start as it is.
  operations.length = 0;
  expect(await projects.setDates(repo, 3, 12, { target: "2026-10-17" })).toBe("set");
  expect(operations.map((o) => [o.operation, o.variables])).toEqual([
    ["IssuePlan", { owner: "octo", name: "sample", number: 12 }],
    ["SetPlanFields", { projectId: "PVT_3", itemId: "PVTI_3", targetField: "F_target", targetValue: "2026-10-17" }],
  ]);

  operations.length = 0;
  expect(await projects.setDates(repo, 3, 13, { start: "2026-10-06" })).toBe("not-in-project");
  expect(await projects.setDates(repo, 3, 14, { start: "2026-10-06" })).toBe("no-field");
  expect(operations.map((o) => o.operation)).toEqual(["IssuePlan", "IssuePlan"]);
});

/** The path GitHub gives a field lookup on the Project of the issue's `index`th item in IssuePlan; GitHub sends the index as a number. */
const itemProjectPath = (index: number) => ["repository", "issue", "projectItems", "nodes", String(index), "project"];

test("setStatus works on a Project without Start and Target fields", async () => {
  // Checked live: an issue in a Project without Start or Target answers IssuePlan with the data plus a NOT_FOUND per missing field.
  // The issue is also in another Project that lacks the fields; that one answers the same way.
  const { fetch, operations } = fakeGraphql({
    IssuePlan: () =>
      new GraphqlErrors(
        issuePlan(12, [
          { id: "PVTI_2", project: planProject(2, "U_octo", false) },
          { id: "PVTI_5", project: planProject(5, "U_octo", false), status: "Shaping" },
        ]),
        [...missingDateFields(itemProjectPath(0)), ...missingDateFields(itemProjectPath(1))],
      ),
    SetPlanStatus: () => ({ updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_5" } } }),
  });
  const projects = port(fetch);

  expect(await projects.getStatus(repo, 5, 12)).toBe("Shaping");
  expect(await projects.setStatus(repo, 5, 12, "Ready")).toBe("set");
  expect(operations.at(-1)).toEqual({ operation: "SetPlanStatus", variables: { projectId: "PVT_5", itemId: "PVTI_5", fieldId: "F_status", optionId: "o_ready" } });
});

test("setDates reports no-field on a Project without Start and Target fields instead of throwing", async () => {
  const { fetch, operations } = fakeGraphql({
    IssuePlan: () => new GraphqlErrors(issuePlan(12, [{ id: "PVTI_5", project: planProject(5, "U_octo", false) }]), missingDateFields(itemProjectPath(0))),
  });
  const projects = port(fetch);

  expect(await projects.setDates(repo, 5, 12, { start: "2026-10-06" })).toBe("no-field");
  expect(operations.map((o) => o.operation)).toEqual(["IssuePlan"]);
});

test("status and date writes work on a Project that lacks Start, Target, Size and Estimate", async () => {
  // Live on todoOverKill #146: a `field(name: "Size")` lookup inside projectItems answered NOT_FOUND at
  // repository.issue.projectItems.nodes.0.project.size next to complete data.
  const { fetch, operations } = fakeGraphql({
    IssuePlan: () =>
      new GraphqlErrors(issuePlan(12, [{ id: "PVTI_5", project: planProject(5, "U_octo", false), status: "Shaping" }]), [
        ...missingDateFields(itemProjectPath(0)),
        ...missingEstimateFields(itemProjectPath(0)),
      ]),
    SetPlanStatus: () => ({ updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_5" } } }),
  });
  const projects = port(fetch);

  expect(await projects.getStatus(repo, 5, 12)).toBe("Shaping");
  expect(await projects.setStatus(repo, 5, 12, "Ready")).toBe("set");
  expect(await projects.setDates(repo, 5, 12, { start: "2026-10-06" })).toBe("no-field");
  expect(operations.map((o) => o.operation)).toEqual(["IssuePlan", "IssuePlan", "SetPlanStatus", "IssuePlan"]);
});

/** GitHub's schema, vendored, to check the documents built at run time that codegen never sees. */
// GitHub publishes a schema that graphql-js would reject for its deprecations, so it is taken as valid.
const githubSchema = buildSchema(readFileSync(new URL("../schema/schema.docs.graphql", import.meta.url), "utf8"), { assumeValid: true });

/** The mutations a document sends, as [alias, mutation]; throws when the document is not valid against GitHub's schema. */
function mutationsOf(query: string): [string, string][] {
  const document = parse(query);
  const errors = validate(githubSchema, document);
  if (errors.length) throw new Error(errors.map((e) => e.message).join("\n"));
  const operation = document.definitions[0];
  if (operation?.kind !== Kind.OPERATION_DEFINITION) throw new Error("not an operation");
  return operation.selectionSet.selections.flatMap((s) => (s.kind === Kind.FIELD ? [[s.alias?.value ?? s.name.value, s.name.value] as [string, string]] : []));
}

/** A Project with every field handoff reads: Status, Start, Target, Size with S, M and L, and Estimate. */
const fullProject = (number: number) => ({ ...planProject(number), size: sizeField("S", "M", "L"), estimate: projectField("F_estimate", "NUMBER") });

test("setPlanFields writes Start, Target, Size and Estimate in one request after one read, and clears a field with null", async () => {
  const { fetch, operations, calls } = fakeGraphql({
    IssuePlan: () => issuePlan(12, [{ id: "PVTI_3", project: fullProject(3) }]),
    SetPlanFields: () => ({ start: { projectV2Item: { id: "PVTI_3" } } }),
  });
  const projects = port(fetch);
  const sentQuery = () => (calls.at(-1)!.body as { query: string }).query;

  expect(await projects.setPlanFields(repo, 3, 12, { start: "2026-10-06", target: "2026-10-07", size: "M", estimate: 10.5 })).toBe("set");
  expect(operations.map((o) => [o.operation, o.variables])).toEqual([
    ["IssuePlan", { owner: "octo", name: "sample", number: 12 }],
    [
      "SetPlanFields",
      {
        projectId: "PVT_3",
        itemId: "PVTI_3",
        startField: "F_start",
        startValue: "2026-10-06",
        targetField: "F_target",
        targetValue: "2026-10-07",
        sizeField: "F_size",
        sizeValue: "o_M",
        estimateField: "F_estimate",
        estimateValue: 10.5,
      },
    ],
  ]);
  expect(mutationsOf(sentQuery())).toEqual([
    ["start", "updateProjectV2ItemFieldValue"],
    ["target", "updateProjectV2ItemFieldValue"],
    ["size", "updateProjectV2ItemFieldValue"],
    ["estimate", "updateProjectV2ItemFieldValue"],
  ]);

  // null clears; a field left out is not sent.
  operations.length = 0;
  expect(await projects.setPlanFields(repo, 3, 12, { size: null, estimate: null, target: "2026-10-09" })).toBe("set");
  expect(operations.map((o) => [o.operation, o.variables])).toEqual([
    ["IssuePlan", { owner: "octo", name: "sample", number: 12 }],
    ["SetPlanFields", { projectId: "PVT_3", itemId: "PVTI_3", targetField: "F_target", targetValue: "2026-10-09", sizeField: "F_size", estimateField: "F_estimate" }],
  ]);
  expect(mutationsOf(sentQuery())).toEqual([
    ["target", "updateProjectV2ItemFieldValue"],
    ["size", "clearProjectV2ItemFieldValue"],
    ["estimate", "clearProjectV2ItemFieldValue"],
  ]);
});

test("setPlanFields reports no-field and no-option and changes nothing", async () => {
  const { fetch, operations } = fakeGraphql({
    IssuePlan: (v) =>
      v.number === 12
        ? // Project #5 live: Status, Start and Target, no Size and no Estimate.
          new GraphqlErrors(issuePlan(12, [{ id: "PVTI_5", project: planProject(5) }]), missingEstimateFields(itemProjectPath(0)))
        : v.number === 13
          ? // Project #1 live: a Size field with its own options and no S, M or L yet, and an Estimate that is text.
            issuePlan(13, [{ id: "PVTI_1", project: { ...planProject(5), size: sizeField("🐋 X-Large", "🦑 Large", "🐂 Medium", "🐇 Small", "🦔 Tiny"), estimate: projectField("F_estimate", "TEXT") } }])
          : issuePlan(14, [{ id: "PVTI_2", project: planProject(2) }]),
  });
  const projects = port(fetch);

  // Start could be written, but Size cannot, so neither is.
  expect(await projects.setPlanFields(repo, 5, 12, { start: "2026-10-06", size: "M" })).toBe("no-field");
  expect(await projects.setPlanFields(repo, 5, 12, { estimate: null })).toBe("no-field");
  expect(await projects.setPlanFields(repo, 5, 13, { target: "2026-10-07", size: "L" })).toBe("no-option");
  expect(await projects.setPlanFields(repo, 5, 13, { estimate: 3 })).toBe("no-field");
  expect(await projects.setPlanFields(repo, 5, 14, { size: "S" })).toBe("not-in-project");
  expect(operations.map((o) => o.operation)).toEqual(["IssuePlan", "IssuePlan", "IssuePlan", "IssuePlan", "IssuePlan"]);
});

/** The PlanItemIds answer: each issue variable `i<n>` as an issue whose items are in the given Projects, null for an issue GitHub lacks. */
function planItemIds(variables: Record<string, unknown>, itemsOf: (issue: number) => { id: string; project: string }[] | null) {
  const issues = Object.entries(variables).filter(([key]) => /^i\d+$/.test(key));
  return {
    repository: Object.fromEntries(
      issues.map(([alias, issue]) => {
        const items = itemsOf(issue as number);
        return [alias, items && { projectItems: { nodes: items.map((i) => ({ id: i.id, project: { id: i.project } })) } }];
      }),
    ),
  };
}

test("setManyPlanFields writes 60 items' Start and Target in a few requests, each valid against GitHub's schema", async () => {
  const issues = Array.from({ length: 60 }, (_, i) => 100 + i);
  const { fetch, operations, calls } = fakeGraphql({
    PlanProject: () => ({ user: { projectV2: { ...planProject(3), url: "u", title: "t" } } }),
    PlanItemIds: (v) => planItemIds(v, (issue) => [{ id: "PVTI_other", project: "PVT_2" }, { id: `PVTI_${issue}`, project: "PVT_3" }]),
    SetManyPlanFields: () => ({}),
  });
  const projects = port(fetch);

  const results = await projects.setManyPlanFields(
    repo,
    3,
    issues.map((issue) => ({ issue, fields: { start: "2026-10-06", target: issue % 2 ? null : "2026-10-09" } })),
  );

  expect(results).toEqual(issues.map((issue) => ({ issue, result: "set" })));
  // One read of the Project, one of the items, then up to 20 mutations a request: 120 writes in 6.
  expect(operations.map((o) => o.operation)).toEqual(["PlanProject", "PlanItemIds", ...Array(6).fill("SetManyPlanFields")]);
  const writes = calls.filter((c) => /^\s*mutation/.test((c.body as { query: string }).query));
  const mutations = writes.flatMap((c) => mutationsOf((c.body as { query: string }).query));
  expect(mutations).toHaveLength(120);
  expect(mutations).toContainEqual(["i101_target", "clearProjectV2ItemFieldValue"]);
  expect(mutations).toContainEqual(["i100_target", "updateProjectV2ItemFieldValue"]);
  // Every item's writes go to its own item in the plan's Project, never to the item in another Project.
  const sent = operations.filter((o) => o.operation === "SetManyPlanFields").map((o) => o.variables);
  expect(sent.every((v) => v.projectId === "PVT_3")).toBe(true);
  expect(sent.flatMap((v) => Object.entries(v).filter(([k]) => k.endsWith("Item")).map(([, id]) => id))).toEqual(issues.map((i) => `PVTI_${i}`));
  expect(sent[0]).toMatchObject({ i100Item: "PVTI_100", i100_startField: "F_start", i100_startValue: "2026-10-06", i100_targetField: "F_target", i100_targetValue: "2026-10-09" });
  const lookup = calls.find((c) => /PlanItemIds/.test((c.body as { query: string }).query))!.body as { query: string };
  expect(validate(githubSchema, parse(lookup.query))).toEqual([]);
});

test("setManyPlanFields writes nothing when an issue is outside the Project or the Project lacks a field, and names only those issues", async () => {
  const { fetch, operations } = fakeGraphql({
    PlanProject: () => ({ user: { projectV2: { ...planProject(3), url: "u", title: "t" } } }),
    // #13 is only in another Project; GitHub has no #14.
    PlanItemIds: (v) => planItemIds(v, (issue) => (issue === 12 ? [{ id: "PVTI_12", project: "PVT_3" }] : issue === 13 ? [{ id: "PVTI_13", project: "PVT_2" }] : null)),
  });
  const projects = port(fetch);

  expect(await projects.setManyPlanFields(repo, 3, [12, 13, 14].map((issue) => ({ issue, fields: { start: "2026-10-06" } })))).toEqual([
    { issue: 13, result: "not-in-project" },
    { issue: 14, result: "not-in-project" },
  ]);
  // The Project has no Estimate field.
  expect(await projects.setManyPlanFields(repo, 3, [{ issue: 12, fields: { start: "2026-10-06", estimate: 3 } }])).toEqual([{ issue: 12, result: "no-field" }]);
  expect(operations.map((o) => o.operation)).toEqual(["PlanProject", "PlanItemIds", "PlanProject", "PlanItemIds"]);
});

/** How createProjectV2Field or updateProjectV2Field answers for a Size field with these options: the sent ids kept, new ones for the rest. */
const sizeFieldFrom = (options: { id?: string; name: string }[]) => ({
  __typename: "ProjectV2SingleSelectField",
  id: "F_size",
  options: options.map((o) => ({ id: o.id ?? `o_${o.name}`, name: o.name, color: "GRAY", description: "" })),
});

test("ensureEstimateFields creates Size with S, M and L and Estimate as a Number once", async () => {
  let project: Record<string, unknown> = { ...planProject(5), url: "u", title: "t" };
  const { fetch, operations } = fakeGraphql({
    PlanProject: () =>
      project.size ? { user: { projectV2: project } } : new GraphqlErrors({ user: { projectV2: { ...project, size: null, estimate: null } } }, missingEstimateFields(["user", "projectV2"])),
    CreatePlanSizeField: (v) => {
      const field = sizeFieldFrom(v.options as { name: string }[]);
      project = { ...project, size: field };
      return { createProjectV2Field: { projectV2Field: field } };
    },
    CreatePlanEstimateField: () => {
      project = { ...project, estimate: projectField("F_estimate", "NUMBER") };
      return { createProjectV2Field: { projectV2Field: projectField("F_estimate", "NUMBER") } };
    },
  });
  const projects = port(fetch);

  const ids = { size: { id: "F_size", options: { S: "o_S", M: "o_M", L: "o_L" } }, estimate: "F_estimate" };
  expect(await projects.ensureEstimateFields("octo", 5)).toEqual(ids);
  expect(operations.map((o) => o.operation)).toEqual(["PlanProject", "CreatePlanSizeField", "CreatePlanEstimateField"]);
  const size = operations[1]!.variables as { projectId: string; name: string; options: { name: string; color: string; description: string }[] };
  expect([size.projectId, size.name, size.options.map((o) => o.name)]).toEqual(["PVT_5", "Size", ["S", "M", "L"]]);
  expect(size.options.every((o) => o.color && o.description)).toBe(true);
  expect(operations[2]!.variables).toEqual({ projectId: "PVT_5", name: "Estimate" });

  operations.length = 0;
  expect(await projects.ensureEstimateFields("octo", 5)).toEqual(ids);
  expect(operations.map((o) => o.operation)).toEqual(["PlanProject"]);
});

test("ensureEstimateFields adds S, M and L to an existing Size field and keeps its options with their ids", async () => {
  // Project #1 live has these five options; here a person has also added M by hand.
  const current = sizeField("🐋 X-Large", "🦑 Large", "M", "🐂 Medium", "🐇 Small", "🦔 Tiny");
  let project: Record<string, unknown> = { ...planProject(1), url: "u", title: "t", size: current, estimate: projectField("F_estimate", "NUMBER") };
  const { fetch, operations } = fakeGraphql({
    PlanProject: () => ({ user: { projectV2: project } }),
    SetPlanSizeOptions: (v) => {
      const field = sizeFieldFrom(v.options as { id?: string; name: string }[]);
      project = { ...project, size: field };
      return { updateProjectV2Field: { projectV2Field: field } };
    },
  });
  const projects = port(fetch);

  expect(await projects.ensureEstimateFields("octo", 1)).toEqual({ size: { id: "F_size", options: { S: "o_S", M: "o_M", L: "o_L" } }, estimate: "F_estimate" });
  expect(operations.map((o) => o.operation)).toEqual(["PlanProject", "SetPlanSizeOptions"]);
  const sent = operations[1]!.variables as { fieldId: string; options: { id?: string; name: string; color: string; description: string }[] };
  expect(sent.fieldId).toBe("F_size");
  // Every existing option goes back with its id, colour and description, so no item loses its value; S and L are added.
  expect(sent.options.slice(0, 6)).toEqual(current.options);
  expect(sent.options.slice(6).map((o) => [o.id, o.name])).toEqual([
    [undefined, "S"],
    [undefined, "L"],
  ]);
  expect(sent.options.slice(6).every((o) => o.color && o.description)).toBe(true);

  operations.length = 0;
  await projects.ensureEstimateFields("octo", 1);
  expect(operations.map((o) => o.operation)).toEqual(["PlanProject"]);
});

test("ensureEstimateFields refuses a Size that is not a single select", async () => {
  let project: Record<string, unknown> = { ...planProject(3), url: "u", title: "t", size: projectField("F_size_text", "TEXT"), estimate: null };
  const { fetch, operations } = fakeGraphql({ PlanProject: () => ({ user: { projectV2: project } }) });
  const projects = port(fetch);

  await expect(projects.ensureEstimateFields("octo", 3)).rejects.toThrow(/has a Size field that is not a single select/);
  expect(operations.map((o) => o.operation)).toEqual(["PlanProject"]);

  // An Estimate that is not a number is refused the same way, before the missing Size is created.
  project = { ...project, size: null, estimate: projectField("F_estimate_text", "TEXT") };
  operations.length = 0;
  await expect(projects.ensureEstimateFields("octo", 3)).rejects.toThrow(/has an Estimate field that is not a number field/);
  expect(operations.map((o) => o.operation)).toEqual(["PlanProject"]);
});

test("setStatus still fails for an issue GitHub cannot resolve", async () => {
  const { fetch } = fakeGraphql({
    IssuePlan: (v) =>
      new GraphqlErrors({ repository: { owner: { id: "U_octo" }, issue: null } }, [
        { type: "NOT_FOUND", path: ["repository", "issue"], message: `Could not resolve to an Issue with the number of ${v.number}.` },
      ]),
  });
  const projects = port(fetch);

  await expect(projects.setStatus(repo, 5, 999, "Ready")).rejects.toThrow(/Could not resolve to an Issue/);
});
