import { readFileSync } from "node:fs";
import { buildSchema, Kind, parse, validate } from "graphql";
import { expect, test } from "vitest";
import { PlanItemsDocument, PlanOwnerIdsDocument, PlanProjectDocument, PlanProjectsDocument, PlanProjectSetupDocument } from "../gql/graphql.ts";
import { fakeFetch, fakeGraphql, GraphqlErrors } from "../testing/fake-fetch.ts";
import { ProjectsAccessError } from "./access.ts";
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
      milestone: null,
      parent: null,
      subIssuesSummary: { total: 0, completed: 0 },
      blockedBy: { nodes: [] },
      closedByPullRequestsReferences: { nodes: [] },
      ...over,
    },
  };
}

/** A page of PlanItems as GitHub answers it through repositoryOwner, for a user's Project unless `owner` says otherwise. */
const page = (nodes: unknown[], endCursor: string | null, hasNextPage: boolean, owner: "User" | "Organization" = "User") => ({
  repositoryOwner: { __typename: owner, projectV2: { items: { pageInfo: { hasNextPage, endCursor }, nodes } } },
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

test("listItems reads each issue's milestone number and title, open or closed, and none as undefined", async () => {
  const milestone = (number: number, title: string) => ({ milestone: { number, title } });
  const { fetch, calls } = fakeGraphql({
    PlanItems: () => page([issueItem(60, milestone(3, "0.9")), issueItem(61, { ...milestone(1, "0.8"), state: "CLOSED" }), issueItem(62)], null, false),
  });

  expect((await port(fetch).listItems("octo", 3, repo)).map((i) => [i.number, i.milestone])).toEqual([
    [60, { number: 3, title: "0.9" }],
    [61, { number: 1, title: "0.8" }],
    [62, undefined],
  ]);
  expect(queryOf(calls[0]!)).toMatch(/milestone \{\s+number\s+title\s+\}/);
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
    PlanProject: () => ({ repositoryOwner: { __typename: "User", projectV2: { ...planProject(3), url: "https://github.com/users/octo/projects/3", title: "sample plan" } } }),
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
    PlanOwnerIds: () => ({ repository: { id: "R_sample", owner: { __typename: "User", id: "U_octo", viewerCanCreateProjects: true } } }),
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
    owner: "User",
    statusOptions: { Shaping: "o_s", Ready: "o_r", Running: "o_run", "In review": "o_rev", Done: "o_done" },
    dateFields: { start: "F_start", target: "F_target" },
  });
  expect(operations.map((o) => o.operation)).toEqual(["PlanOwnerIds", "CreatePlanProject", "SetStatusOptions", "CreatePlanDateField", "CreatePlanDateField", "LinkPlanRepository"]);
  expect(operations.filter((o) => o.operation === "CreatePlanDateField").map((o) => o.variables)).toEqual([
    { projectId: "PVT_9", name: "Start" },
    { projectId: "PVT_9", name: "Target" },
  ]);
  expect(operations[0]!.variables).toEqual({ owner: "octo", name: "sample" });
  expect(operations[1]!.variables).toEqual({ ownerId: "U_octo", title: "sample plan" });
  const options = (operations[2]!.variables.options as { id?: string; name: string; color: string; description: string }[]).map(({ id, name, color, description }) => ({ id, name, color, description }));
  expect(operations[2]!.variables.fieldId).toBe("F_status");
  expect(options.map((o) => o.name)).toEqual(["Shaping", "Ready", "Running", "In review", "Done"]);
  // Done keeps its option id, colour and description, so GitHub's "Item closed" workflow still finds it.
  expect(options[4]).toEqual({ id: "o_done", name: "Done", color: "PURPLE", description: "This has been completed" });
  expect(options.slice(0, 4).every((o) => o.id === undefined)).toBe(true);
  expect(operations.at(-1)!.variables).toEqual({ projectId: "PVT_9", repositoryId: "R_sample" });
});

test("createProject without date fields creates no Start or Target field, for a project that plans in Flow mode", async () => {
  const field = { __typename: "ProjectV2SingleSelectField", id: "F_status", options: [{ id: "o_done", name: "Done", color: "PURPLE", description: "Done" }] };
  const { fetch, operations } = fakeGraphql({
    PlanOwnerIds: () => ({ repository: { id: "R_sample", owner: { __typename: "User", id: "U_octo", viewerCanCreateProjects: true } } }),
    CreatePlanProject: () => ({ createProjectV2: { projectV2: { id: "PVT_9", number: 9, url: "u", title: "sample plan", field } } }),
    SetStatusOptions: () => ({ updateProjectV2Field: { projectV2Field: field } }),
    LinkPlanRepository: () => ({ linkProjectV2ToRepository: { repository: { id: "R_sample" } } }),
  });

  expect(await port(fetch).createProject("octo", repo, "sample plan", { dateFields: false })).toMatchObject({ number: 9, dateFields: { start: undefined, target: undefined } });
  expect(operations.map((o) => o.operation)).toEqual(["PlanOwnerIds", "CreatePlanProject", "SetStatusOptions", "LinkPlanRepository"]);
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
    PlanProject: () => ({ repositoryOwner: { __typename: "User", projectV2: { ...planProject(3), url: "u", title: "t" } } }),
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
    PlanProject: () => ({ repositoryOwner: { __typename: "User", projectV2: { ...planProject(3), url: "u", title: "t" } } }),
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

test("createIssue puts the new issue in a milestone, looked up by number with the labels and parent", async () => {
  const { fetch, operations } = fakeGraphql({
    IssueCreateRefs: (v) => ({ repository: { id: "R_sample", labels: { nodes: [{ id: "L_task", name: "task" }] }, ...(v.withMilestone ? { milestone: { id: `MI_${v.milestone}` } } : {}) } }),
    CreatePlanIssue: () => ({ createIssue: { issue: { id: "I_20", number: 20, url: "https://github.com/octo/sample/issues/20" } } }),
    IssuePlan: () => issuePlan(20, [{ id: "PVTI_20", project: planProject(3), status: "Shaping" }]),
    SetPlanStatus: () => ({ updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_20" } } }),
  });

  await port(fetch).createIssue(repo, { project: 3, title: "Add the migration", body: "A column.", labels: ["task"], milestone: 3 });

  const sent = (name: string) => operations.filter((o) => o.operation === name).map((o) => o.variables);
  expect(sent("IssueCreateRefs")).toEqual([{ owner: "octo", name: "sample", parent: 0, withParent: false, milestone: 3, withMilestone: true }]);
  expect(sent("CreatePlanIssue")).toEqual([{ repositoryId: "R_sample", title: "Add the migration", body: "A column.", labelIds: ["L_task"], milestoneId: "MI_3" }]);
});

test("createIssue refuses a milestone the repository does not have, before creating anything", async () => {
  // GitHub answers a milestone number the repository lacks with null and no error.
  const { fetch, operations } = fakeGraphql({
    IssueCreateRefs: () => ({ repository: { id: "R_sample", labels: { nodes: [{ id: "L_task", name: "task" }] }, milestone: null } }),
  });

  await expect(port(fetch).createIssue(repo, { project: 3, title: "T", body: "B", labels: ["task"], milestone: 7 })).rejects.toThrow("octo/sample has no milestone #7");
  expect(operations.map((o) => o.operation)).toEqual(["IssueCreateRefs"]);
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
      repositoryOwner: {
        __typename: "User",
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
    PlanProjectSetup: () => ({ repositoryOwner: { __typename: "User", projectV2: userProject(1, "Untitled", current) } }),
    PlanOwnerIds: () => ({ repository: { id: "R_sample", owner: { __typename: "User", id: "U_octo", viewerCanCreateProjects: true } } }),
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
      owner: "User",
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
      repositoryOwner: {
        __typename: "User",
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
    PlanProject: () => ({ repositoryOwner: { __typename: "User", projectV2: { ...planProject(3), url: "u", title: "t" } } }),
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
        ? { repositoryOwner: { __typename: "User", projectV2: { ...planProject(3), url: "https://github.com/users/octo/projects/3", title: "sample plan" } } }
        : // GitHub answers a Project number it cannot resolve with a NOT_FOUND error next to the null.
          new GraphqlErrors({ repositoryOwner: { __typename: "User", projectV2: null } }, [{ type: "NOT_FOUND", path: ["repositoryOwner", "projectV2"], message: `Could not resolve to a ProjectV2 with the number ${v.number}.` }]),
  });
  const projects = port(fetch);

  expect(await projects.getProject("octo", 3)).toEqual({
    number: 3,
    url: "https://github.com/users/octo/projects/3",
    title: "sample plan",
    owner: "User",
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
      repositoryOwner: {
        __typename: "User",
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
    PlanProject: () => new GraphqlErrors({ repositoryOwner: { __typename: "User", projectV2: project } }, missingDateFields(["repositoryOwner", "projectV2"])),
    PlanProjects: () => new GraphqlErrors({ repositoryOwner: { __typename: "User", projectsV2: { nodes: [project] } } }, missingDateFields(["repositoryOwner", "projectsV2", "nodes", "0"])),
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
    PlanProject: (v) => (v.number === 5 ? new GraphqlErrors({ repositoryOwner: { __typename: "User", projectV2: bare } }, missingEstimateFields(["repositoryOwner", "projectV2"])) : { repositoryOwner: { __typename: "User", projectV2: sized } }),
    PlanProjects: () => new GraphqlErrors({ repositoryOwner: { __typename: "User", projectsV2: { nodes: [bare] } } }, missingEstimateFields(["repositoryOwner", "projectsV2", "nodes", "0"])),
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
    path: ["repositoryOwner", "projectV2", "priority"],
    message: "Could not resolve to a Unions::ProjectV2FieldConfiguration with the name Priority",
  };
  const { fetch } = fakeGraphql({
    PlanProject: () => new GraphqlErrors({ repositoryOwner: { __typename: "User", projectV2: project } }, [...missingDateFields(["repositoryOwner", "projectV2"]), missingPriority]),
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
    PlanProject: () => ({ repositoryOwner: { __typename: "User", projectV2: project } }),
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
    PlanProject: () => ({ repositoryOwner: { __typename: "User", projectV2: { ...planProject(3), url: "u", title: "t" } } }),
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
    PlanProject: () => ({ repositoryOwner: { __typename: "User", projectV2: { ...planProject(3), url: "u", title: "t" } } }),
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

test("listItems returns each item's id", async () => {
  const draft = { id: "PVTI_draft", status: null, content: { __typename: "DraftIssue" } };
  const { fetch, calls } = fakeGraphql({
    PlanItems: () => page([{ ...issueItem(7), id: "PVTI_7" }, draft, { ...issueItem(3), id: "PVTI_3" }], null, false),
  });
  const projects = port(fetch);

  expect((await projects.listItems("octo", 3, repo)).map((i) => [i.number, i.position, i.itemId])).toEqual([
    [7, 1, "PVTI_7"],
    [3, 3, "PVTI_3"],
  ]);
  // The query selects the id on each item, so a write can name it.
  const sent = parse((calls[0]!.body as { query: string }).query);
  expect(validate(githubSchema, sent)).toEqual([]);
  expect((calls[0]!.body as { query: string }).query).toMatch(/nodes\s*{\s*id\b/);
});

/** The PlanProject answer for Project #3, the plan the moves go to. */
const movesProject = () => ({ repositoryOwner: { __typename: "User", projectV2: { ...planProject(3), url: "u", title: "t" } } });
const moves = (count: number) => Array.from({ length: count }, (_, i) => ({ itemId: `PVTI_${i + 1}`, afterId: i === 0 ? null : `PVTI_${i}` }));

test("moveItems sends the moves in order, 20 per request", async () => {
  const { fetch, operations, calls } = fakeGraphql({
    PlanProject: movesProject,
    MovePlanItems: (v) => Object.fromEntries(Object.keys(v).filter((k) => k.endsWith("Item")).map((k) => [k.slice(0, -4), { clientMutationId: null }])),
    MovePlanItem: () => ({ updateProjectV2ItemPosition: { clientMutationId: null } }),
  });
  const projects = port(fetch);

  await projects.moveItems("octo", 3, moves(45));

  // One read of the Project for its id, then 45 moves in requests of 20, 20 and 5.
  expect(operations.map((o) => o.operation)).toEqual(["PlanProject", "MovePlanItems", "MovePlanItems", "MovePlanItems"]);
  const writes = calls.slice(1).map((c) => mutationsOf((c.body as { query: string }).query));
  expect(writes.map((w) => w.length)).toEqual([20, 20, 5]);
  expect(writes.flat().every(([, mutation]) => mutation === "updateProjectV2ItemPosition")).toBe(true);
  // The moves go out in the order given, each with its afterId; the first goes to the top with null.
  const sent = operations.slice(1).flatMap((o) => {
    const count = Object.keys(o.variables).filter((k) => k.endsWith("Item")).length;
    expect(o.variables.projectId).toBe("PVT_3");
    return Array.from({ length: count }, (_, i) => ({ itemId: o.variables[`m${i + 1}Item`], afterId: o.variables[`m${i + 1}After`] }));
  });
  expect(sent).toEqual(moves(45));

  // A single move, as a drag writes, is the MovePlanItem operation; no moves send nothing.
  operations.length = 0;
  await projects.moveItems("octo", 3, [{ itemId: "PVTI_9", afterId: null }]);
  await projects.moveItems("octo", 3, []);
  expect(operations).toEqual([
    { operation: "PlanProject", variables: { login: "octo", number: 3 } },
    { operation: "MovePlanItem", variables: { projectId: "PVT_3", itemId: "PVTI_9", afterId: null } },
  ]);
});

test("a refusal part way throws naming how many moved", async () => {
  const { fetch, operations } = fakeGraphql({
    PlanProject: movesProject,
    // The second request's fourth move names an item that left the Project; GitHub runs the others.
    MovePlanItems: (v) => {
      const aliases = Object.keys(v).filter((k) => k.endsWith("Item")).map((k) => k.slice(0, -4));
      if (v.m1Item === "PVTI_1") return Object.fromEntries(aliases.map((a) => [a, { clientMutationId: null }]));
      return new GraphqlErrors(Object.fromEntries(aliases.map((a) => [a, a === "m4" ? null : { clientMutationId: null }])), [
        { type: "NOT_FOUND", message: "Could not resolve to a node with the global id of 'PVTI_24'", path: ["m4"] },
      ]);
    },
  });
  const projects = port(fetch);

  await expect(projects.moveItems("octo", 3, moves(50))).rejects.toThrow(/GitHub moved 39 of 50 items in Project order, then refused: .*PVTI_24/);
  // Nothing is sent after the refused request.
  expect(operations.map((o) => o.operation)).toEqual(["PlanProject", "MovePlanItems", "MovePlanItems"]);

  // A request GitHub refuses whole moves nothing in it.
  const failing = fakeGraphql({ PlanProject: movesProject, MovePlanItem: () => new GraphqlErrors(null, [{ message: "Something went wrong" }]) });
  await expect(port(failing.fetch).moveItems("octo", 3, moves(1))).rejects.toThrow(/GitHub moved 0 of 1 items in Project order, then refused: .*Something went wrong/);
});

test("moveItems throws when the Project does not exist", async () => {
  const { fetch, operations } = fakeGraphql({ PlanProject: () => new GraphqlErrors({ repositoryOwner: { __typename: "User", projectV2: null } }, [{ type: "NOT_FOUND", message: "Could not resolve to a ProjectV2" }]) });

  await expect(port(fetch).moveItems("octo", 9, moves(2))).rejects.toThrow(/Project #9 of octo does not exist/);
  expect(operations.map((o) => o.operation)).toEqual(["PlanProject"]);
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
      project.size ? { repositoryOwner: { __typename: "User", projectV2: project } } : new GraphqlErrors({ repositoryOwner: { __typename: "User", projectV2: { ...project, size: null, estimate: null } } }, missingEstimateFields(["repositoryOwner", "projectV2"])),
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
    PlanProject: () => ({ repositoryOwner: { __typename: "User", projectV2: project } }),
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

test("ensureEstimateFields without the estimate creates only Size, for a project that plans in Flow mode", async () => {
  const project: Record<string, unknown> = { ...planProject(5), url: "u", title: "t", size: null, estimate: null };
  const { fetch, operations } = fakeGraphql({
    PlanProject: () => ({ repositoryOwner: { __typename: "User", projectV2: project } }),
    CreatePlanSizeField: (v) => ({ createProjectV2Field: { projectV2Field: sizeFieldFrom(v.options as { name: string }[]) } }),
  });

  expect(await port(fetch).ensureEstimateFields("octo", 5, { estimate: false })).toEqual({ size: { id: "F_size", options: { S: "o_S", M: "o_M", L: "o_L" } }, estimate: undefined });
  expect(operations.map((o) => o.operation)).toEqual(["PlanProject", "CreatePlanSizeField"]);
});

test("ensureEstimateFields refuses a Size that is not a single select", async () => {
  let project: Record<string, unknown> = { ...planProject(3), url: "u", title: "t", size: projectField("F_size_text", "TEXT"), estimate: null };
  const { fetch, operations } = fakeGraphql({ PlanProject: () => ({ repositoryOwner: { __typename: "User", projectV2: project } }) });
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

test("listItems on an organization that requires SSO throws a ProjectsAccessError with reason sso", async () => {
  // https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api: a 403 whose X-GitHub-SSO header holds the URL that authorizes the token.
  const url = "https://github.com/orgs/acme/sso?authorization_request=A1B2C3";
  const { fetch } = fakeFetch({
    "POST /graphql": () => ({
      status: 403,
      headers: { "x-github-sso": `required; url=${url}` },
      json: { message: "Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization." },
    }),
  });

  const thrown = await port(fetch)
    .listItems("acme", 4, { owner: "acme", name: "web" })
    .catch((error: unknown) => error);

  expect(thrown).toBeInstanceOf(ProjectsAccessError);
  expect(thrown).toMatchObject({ reason: "sso", message: expect.stringContaining(`acme uses SAML single sign-on, and GITHUB_TOKEN is not authorized for it. Authorize the token at ${url}`) });
});

test("getProject without the read:project scope throws a ProjectsAccessError that names it", async () => {
  const { fetch } = fakeGraphql({
    PlanProject: () =>
      new GraphqlErrors({ repositoryOwner: null }, [
        {
          type: "INSUFFICIENT_SCOPES",
          message:
            "Your token has not been granted the required scopes to execute this query. The 'id' field requires one of the following scopes: ['read:project'], but your token has only been granted the: ['repo'] scopes. Please modify your token's scopes at: https://github.com/settings/tokens.",
        },
      ]),
  });

  await expect(port(fetch).getProject("acme", 4)).rejects.toMatchObject({ name: "ProjectsAccessError", reason: "scope", message: expect.stringContaining("lacks the read:project scope") });
});

/** A repository of the organization `acme`, whose plan is a Project the organization owns. */
const orgRepo = { owner: "acme", name: "web" };

/** A PlanItems item whose content is an issue of `acme/web`. */
const orgIssueItem = (number: number, over: Record<string, unknown> = {}, status: string | null = null) =>
  issueItem(number, { url: `https://github.com/acme/web/issues/${number}`, repository: { name: "web", owner: { login: "acme" } }, ...over }, status);

/** How GitHub answers PlanOwnerIds for `acme/web`: the repository with its owner, the organization. */
const orgOwnerIds = (viewerCanCreateProjects = true) => ({ repository: { id: "R_web", owner: { __typename: "Organization", id: "O_acme", viewerCanCreateProjects } } });

/** The text of the GraphQL request a call sent. */
const queryOf = (call: { body: unknown }) => (call.body as { query: string }).query;

test("listItems reads an organization's Project through repositoryOwner and returns the repository's issues", async () => {
  const task = orgIssueItem(1, { labels: { nodes: [{ name: "task" }] } }, "Ready");
  // The organization's issue type Task names the kind when the issue has no kind label.
  const typed = orgIssueItem(2, { issueType: { name: "Task" } }, "Shaping");
  // An organization Project holds issues of other repositories too; they are not this repository's plan.
  const elsewhere = issueItem(3);
  const { fetch, operations, calls } = fakeGraphql({ PlanItems: () => page([task, typed, elsewhere], null, false, "Organization") });

  const items = await port(fetch).listItems("acme", 4, orgRepo);

  expect(items.map((i) => [i.number, i.kind, i.status, i.url, i.position])).toEqual([
    [1, "task", "Ready", "https://github.com/acme/web/issues/1", 1],
    [2, "task", "Shaping", "https://github.com/acme/web/issues/2", 2],
  ]);
  expect(operations).toEqual([{ operation: "PlanItems", variables: { login: "acme", number: 4 } }]);
  expect(queryOf(calls[0]!)).toMatch(/repositoryOwner\(login: \$login\)/);
  expect(queryOf(calls[0]!)).not.toMatch(/\buser\(/);
});

test("listItems reads the milestone of an organization repository's issues", async () => {
  const { fetch } = fakeGraphql({ PlanItems: () => page([orgIssueItem(1, { milestone: { number: 2, title: "Redesign beta" } }), orgIssueItem(2)], null, false, "Organization") });

  expect((await port(fetch).listItems("acme", 4, orgRepo)).map((i) => [i.number, i.milestone])).toEqual([
    [1, { number: 2, title: "Redesign beta" }],
    [2, undefined],
  ]);
});

test("a user's Project is still read in one request per page", async () => {
  const { fetch, operations, calls } = fakeGraphql({
    PlanItems: (v) => (v.cursor ? page([issueItem(3)], null, false) : page([issueItem(1), issueItem(2)], "c1", true)),
  });

  expect((await port(fetch).listItems("octo", 3, repo)).map((i) => [i.number, i.position])).toEqual([
    [1, 1],
    [2, 2],
    [3, 3],
  ]);
  // No query runs first to learn the owner type: each page is one PlanItems request.
  expect(operations).toEqual([
    { operation: "PlanItems", variables: { login: "octo", number: 3 } },
    { operation: "PlanItems", variables: { login: "octo", number: 3, cursor: "c1" } },
  ]);
  expect(calls).toHaveLength(2);
  expect(queryOf(calls[0]!)).toMatch(/repositoryOwner\(login: \$login\)/);
});

test("getProject reads an organization's Project and says an organization owns it", async () => {
  const { fetch, operations } = fakeGraphql({
    PlanProject: (v) =>
      v.number === 4
        ? { repositoryOwner: { __typename: "Organization", projectV2: { ...planProject(4, "O_acme"), url: "https://github.com/orgs/acme/projects/4", title: "web plan" } } }
        : // The organization exists and the Project does not: GitHub still answers the owner's type next to the NOT_FOUND.
          new GraphqlErrors({ repositoryOwner: { __typename: "Organization", projectV2: null } }, [
            { type: "NOT_FOUND", path: ["repositoryOwner", "projectV2"], message: `Could not resolve to a ProjectV2 with the number ${v.number}.` },
          ]),
  });
  const projects = port(fetch);

  expect(await projects.getProject("acme", 4)).toEqual({
    number: 4,
    url: "https://github.com/orgs/acme/projects/4",
    title: "web plan",
    owner: "Organization",
    statusOptions: { Shaping: "o_shaping", Ready: "o_ready", Running: "o_running", "In review": "o_review", Done: "o_done" },
    dateFields: { start: "F_start", target: "F_target" },
    estimateFields: { size: undefined, estimate: undefined },
  });
  expect(operations).toEqual([{ operation: "PlanProject", variables: { login: "acme", number: 4 } }]);
  expect(await projects.getProject("acme", 9)).toBeUndefined();
  // A message about a Project the token cannot find names the organization as one.
  await expect(projects.ensureDateFields("acme", 9)).rejects.toThrow("GitHub Project #9 of the organization acme does not exist or GITHUB_TOKEN cannot see it.");
});

test("listProjects lists the Projects the token can write for an organization repository, linked first", async () => {
  const orgProject = (number: number, title: string, repositories: { name: string; owner: string }[] = []) => ({
    ...userProject(number, title, statusOptions("Shaping", "Ready", "Running", "In review", "Done"), repositories),
    url: `https://github.com/orgs/acme/projects/${number}`,
  });
  const { fetch, operations, calls } = fakeGraphql({
    PlanProjects: () => ({
      repositoryOwner: {
        __typename: "Organization",
        projectsV2: { nodes: [orgProject(2, "Roadmap", [{ name: "api", owner: "acme" }]), orgProject(1, "web plan", [{ name: "web", owner: "acme" }])] },
      },
    }),
  });

  expect(await port(fetch).listProjects("acme", orgRepo)).toEqual([
    { number: 1, title: "web plan", url: "https://github.com/orgs/acme/projects/1", linked: true, missingStatusOptions: [] },
    { number: 2, title: "Roadmap", url: "https://github.com/orgs/acme/projects/2", linked: false, missingStatusOptions: [] },
  ]);
  expect(operations).toEqual([{ operation: "PlanProjects", variables: { login: "acme" } }]);
  // Only Projects the token can write are worth offering to setup.
  expect(queryOf(calls[0]!)).toMatch(/projectsV2\([^)]*minPermissionLevel: WRITE/);
});

test("adoptProject links an organization Project to the organization's repository", async () => {
  const { fetch, operations } = fakeGraphql({
    PlanProjectSetup: () => ({
      repositoryOwner: {
        __typename: "Organization",
        projectV2: { ...userProject(6, "Team board", statusOptions("Shaping", "Ready", "Running", "In review", "Done")), url: "https://github.com/orgs/acme/projects/6" },
      },
    }),
    PlanOwnerIds: () => orgOwnerIds(),
    LinkPlanRepository: () => ({ linkProjectV2ToRepository: { repository: { id: "R_web" } } }),
  });

  const adopted = await port(fetch).adoptProject("acme", 6, orgRepo);

  expect(adopted.project).toMatchObject({ number: 6, url: "https://github.com/orgs/acme/projects/6", owner: "Organization", statusOptions: { Shaping: "o_0", Done: "o_4" } });
  expect(operations).toEqual([
    { operation: "PlanProjectSetup", variables: { login: "acme", number: 6 } },
    { operation: "PlanOwnerIds", variables: { owner: "acme", name: "web" } },
    { operation: "LinkPlanRepository", variables: { projectId: "PVT_6", repositoryId: "R_web" } },
  ]);
});

test("createProject creates the Project under the repository's owner when it is an organization, and links it", async () => {
  const field = { __typename: "ProjectV2SingleSelectField", id: "F_status", options: [{ id: "o_done", name: "Done", color: "PURPLE", description: "Done" }] };
  const { fetch, operations } = fakeGraphql({
    PlanOwnerIds: () => orgOwnerIds(),
    CreatePlanProject: () => ({ createProjectV2: { projectV2: { id: "PVT_7", number: 7, url: "https://github.com/orgs/acme/projects/7", title: "web plan", field } } }),
    SetStatusOptions: () => ({ updateProjectV2Field: { projectV2Field: field } }),
    LinkPlanRepository: () => ({ linkProjectV2ToRepository: { repository: { id: "R_web" } } }),
  });

  expect(await port(fetch).createProject("acme", orgRepo, "web plan", { dateFields: false })).toMatchObject({
    number: 7,
    url: "https://github.com/orgs/acme/projects/7",
    owner: "Organization",
  });
  const sent = (name: string) => operations.filter((o) => o.operation === name).map((o) => o.variables);
  expect(sent("PlanOwnerIds")).toEqual([{ owner: "acme", name: "web" }]);
  expect(sent("CreatePlanProject")).toEqual([{ ownerId: "O_acme", title: "web plan" }]);
  expect(sent("LinkPlanRepository")).toEqual([{ projectId: "PVT_7", repositoryId: "R_web" }]);
});

test("createProject refuses before creating anything when the account cannot create Projects there", async () => {
  const { fetch, operations } = fakeGraphql({ PlanOwnerIds: () => orgOwnerIds(false) });

  await expect(port(fetch).createProject("acme", orgRepo, "web plan")).rejects.toThrow(
    "Your GitHub account cannot create Projects in acme. An organization owner can let members create Projects, or create one and run setup_plan with use.",
  );
  expect(operations.map((o) => o.operation)).toEqual(["PlanOwnerIds"]);
});

test("every plan document is valid against GitHub's schema", () => {
  const documents = { PlanItemsDocument, PlanOwnerIdsDocument, PlanProjectDocument, PlanProjectsDocument, PlanProjectSetupDocument };
  for (const [name, document] of Object.entries(documents)) {
    const text = document.toString();
    expect(validate(githubSchema, parse(text)), name).toEqual([]);
    // A Project read through user(login:) finds nothing when an organization owns the repository.
    expect(text, name).not.toMatch(/\buser\(/);
  }
});

/** An issue's value of an organization's single select issue field, as `issueFieldValues` answers it. */
const issueFieldValue = (field: string, name: string) => ({ __typename: "IssueFieldSingleSelectValue", name, field: { __typename: "IssueFieldSingleSelect", name: field } });
/** An issue's issue field values, as PlanItems reads them on each issue. */
const issueFields = (...nodes: unknown[]) => ({ issueFieldValues: { nodes } });
/** The organization's Priority issue field as `issueFields` lists it, in another order than its `priority` numbers. */
const priorityIssueField = {
  __typename: "IssueFieldSingleSelect",
  name: "Priority",
  options: [
    { name: "Low", priority: 4 },
    { name: "Urgent", priority: 1 },
    { name: "Medium", priority: 3 },
    { name: "High", priority: 2 },
  ],
};
/** Other default issue fields of an organization, which handoff does not read, as Task-Insight answers PlanProject live. */
const otherIssueFields = [
  { __typename: "IssueFieldDate" },
  { __typename: "IssueFieldSingleSelect", name: "Effort", options: [{ name: "High", priority: 1 }] },
];
/** How `field(name: "Priority")` answers on a Project without such a field: a NOT_FOUND next to the data. */
const missingPriority = (path: string[]) => ({ type: "NOT_FOUND", path: [...path, "priority"], message: "Could not resolve to a Unions::ProjectV2FieldConfiguration with the name Priority" });
/** A PlanItems page of an organization's Project whose `field(name: "Priority")` answers `priority`; null answers with a NOT_FOUND. */
const orgPage = (nodes: unknown[], priority: unknown) => {
  const data = { repositoryOwner: { __typename: "Organization", projectV2: { priority, items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } };
  return priority === null ? new GraphqlErrors(data, [missingPriority(["repositoryOwner", "projectV2"])]) : data;
};
/** A PlanProject answer for the organization acme's Project #4 with the given Priority field and the organization's issue fields. */
const orgPlanProject = (priority: unknown, fields: unknown[]) => {
  const data = {
    repositoryOwner: {
      __typename: "Organization",
      issueFields: { nodes: fields },
      projectV2: { ...planProject(4, "O_acme"), url: "https://github.com/orgs/acme/projects/4", title: "web plan", priority },
    },
  };
  return priority === null ? new GraphqlErrors(data, [missingPriority(["repositoryOwner", "projectV2"])]) : data;
};

test("in an organization whose Project has no Priority field, listItems reads each issue's Priority issue field and getProject returns its options in priority order", async () => {
  const urgent = { ...orgIssueItem(1, issueFields(issueFieldValue("Effort", "High"), issueFieldValue("Priority", "Urgent"))), priority: null };
  const high = { ...orgIssueItem(2, issueFields(issueFieldValue("Priority", "High"))), priority: null };
  const none = { ...orgIssueItem(3, issueFields(issueFieldValue("Effort", "Low"))), priority: null };
  const { fetch } = fakeGraphql({
    PlanItems: () => orgPage([urgent, high, none], null),
    PlanProject: () => orgPlanProject(null, [priorityIssueField, ...otherIssueFields]),
  });
  const projects = port(fetch);

  expect((await projects.listItems("acme", 4, orgRepo)).map((i) => [i.number, i.priority])).toEqual([
    [1, "Urgent"],
    [2, "High"],
    [3, undefined],
  ]);
  expect(await projects.getProject("acme", 4)).toMatchObject({ owner: "Organization", priorityOptions: ["Urgent", "High", "Medium", "Low"], prioritySource: "issue-field" });
});

test("a Project's own Priority field wins over the organization's issue field", async () => {
  const own = { __typename: "ProjectV2SingleSelectField", isIssueField: false, options: [{ name: "P0" }, { name: "P1" }] };
  const p1 = { ...orgIssueItem(1, issueFields(issueFieldValue("Priority", "Urgent"))), priority: { __typename: "ProjectV2ItemFieldSingleSelectValue", name: "P1" } };
  // No value in the Project's own field: the issue field's Urgent does not stand in for it.
  const unset = { ...orgIssueItem(2, issueFields(issueFieldValue("Priority", "Urgent"))), priority: null };
  const { fetch } = fakeGraphql({
    PlanItems: () => orgPage([p1, unset], own),
    PlanProject: () => orgPlanProject(own, [priorityIssueField]),
  });
  const projects = port(fetch);

  expect((await projects.listItems("acme", 4, orgRepo)).map((i) => [i.number, i.priority])).toEqual([
    [1, "P1"],
    [2, undefined],
  ]);
  expect(await projects.getProject("acme", 4)).toMatchObject({ priorityOptions: ["P0", "P1"], prioritySource: "project" });
});

test("a Priority column backed by the issue field reads the issue's value", async () => {
  const column = { __typename: "ProjectV2SingleSelectField", isIssueField: true, options: [{ name: "Urgent" }, { name: "High" }, { name: "Medium" }, { name: "Low" }] };
  // How GitHub answers the item's value for such a column is unverified; handoff reads the issue's value instead.
  const item = { ...orgIssueItem(1, issueFields(issueFieldValue("Priority", "Medium"))), priority: { __typename: "ProjectV2ItemIssueFieldValue" } };
  const { fetch } = fakeGraphql({
    PlanItems: () => orgPage([item], column),
    PlanProject: () => orgPlanProject(column, [priorityIssueField]),
  });
  const projects = port(fetch);

  expect((await projects.listItems("acme", 4, orgRepo)).map((i) => [i.number, i.priority])).toEqual([[1, "Medium"]]);
  expect(await projects.getProject("acme", 4)).toMatchObject({ priorityOptions: ["Urgent", "High", "Medium", "Low"], prioritySource: "issue-field" });
});

test("a user's Project reads Priority as before and has no issue field source", async () => {
  const own = { __typename: "ProjectV2SingleSelectField", isIssueField: false, options: [{ name: "High" }, { name: "Low" }] };
  // A user's repository has no issue fields: GitHub answers an empty list on each issue.
  const high = { ...issueItem(1, issueFields()), priority: { __typename: "ProjectV2ItemFieldSingleSelectValue", name: "High" } };
  // A Project without a Priority field answers each item's fieldValueByName with null.
  const userPage = (priority: unknown) => ({
    repositoryOwner: { __typename: "User", projectV2: { priority, items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [priority ? high : { ...high, priority: null }] } } },
  });
  const userAnswer = (number: number, priority: unknown) => ({ repositoryOwner: { __typename: "User", projectV2: { ...planProject(number), url: "u", title: "t", priority } } });
  const missing = [missingPriority(["repositoryOwner", "projectV2"])];
  const { fetch } = fakeGraphql({
    PlanItems: (v) => (v.number === 3 ? userPage(own) : new GraphqlErrors(userPage(null), missing)),
    PlanProject: (v) => (v.number === 3 ? userAnswer(3, own) : new GraphqlErrors(userAnswer(5, null), missing)),
  });
  const projects = port(fetch);

  expect((await projects.listItems("octo", 3, repo)).map((i) => [i.number, i.priority])).toEqual([[1, "High"]]);
  expect(await projects.getProject("octo", 3)).toMatchObject({ owner: "User", priorityOptions: ["High", "Low"], prioritySource: "project" });
  // Without a Priority field of its own, a user's Project has no Priority at all.
  expect((await projects.listItems("octo", 5, repo)).map((i) => [i.number, i.priority])).toEqual([[1, undefined]]);
  const bare = await projects.getProject("octo", 5);
  expect(bare?.priorityOptions).toBeUndefined();
  expect(bare?.prioritySource).toBeUndefined();
});

/** acme/sample after GitHub moved it from octo: its issues are still items of octo's Project #5, to copy into acme's Project #7. */
const moved = { owner: "acme", name: "sample" };
/** An item of octo's Project #5 whose issue now belongs to acme/sample, with its node id `I_<n>`. */
const movedItem = (number: number, over: Record<string, unknown> = {}, status: string | null = null) => ({
  ...issueItem(number, { id: `I_${number}`, url: `https://github.com/acme/sample/issues/${number}`, repository: { name: "sample", owner: { login: "acme" } }, ...over }, status),
  id: `PVTI_old_${number}`,
});
/** octo's Project #5 as PlanItems reads it, with a Priority field of its own. */
const sourcePage = (nodes: unknown[]) => ({
  repositoryOwner: {
    __typename: "User",
    projectV2: { priority: { __typename: "ProjectV2SingleSelectField", isIssueField: false }, items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } },
  },
});

/**
 * GitHub for a copy from octo's Project #5 into acme's Project #7, which has Status and Size. The target's Project
 * order lives here: GitHub is taken to put each added item at the top, so only the moves give the source order.
 */
function copyGitHub(source: unknown[], target: Record<string, unknown> = { size: sizeField("S", "M", "L") }) {
  const order: string[] = [];
  const issueOf = new Map<string, number>();
  const add = (contentId: string) => {
    const issue = Number(contentId.slice("I_".length));
    const itemId = `PVTI_new_${issue}`;
    if (!order.includes(itemId)) order.unshift(itemId);
    issueOf.set(itemId, issue);
    return { item: { id: itemId } };
  };
  const move = (itemId: string, afterId: string | null) => {
    order.splice(order.indexOf(itemId), 1);
    order.splice(afterId === null ? 0 : order.indexOf(afterId) + 1, 0, itemId);
    return { clientMutationId: null };
  };
  const aliases = (v: Record<string, unknown>, suffix: string) =>
    Object.keys(v)
      .filter((k) => k.endsWith(suffix))
      .map((k) => k.slice(0, -suffix.length));
  const handlers = fakeGraphql({
    PlanItems: (v) =>
      v.login === "octo"
        ? sourcePage(source)
        : {
            repositoryOwner: {
              __typename: "Organization",
              projectV2: { priority: null, items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: order.map((id) => ({ ...movedItem(issueOf.get(id)!), id })) } },
            },
          },
    PlanProject: () => ({
      repositoryOwner: { __typename: "Organization", issueFields: { nodes: [] }, projectV2: { ...planProject(7, "O_acme"), url: "https://github.com/orgs/acme/projects/7", title: "sample plan", ...target } },
    }),
    AddPlanItem: (v) => ({ addProjectV2ItemById: add(v.contentId as string) }),
    AddPlanItems: (v) => Object.fromEntries(aliases(v, "Content").map((a) => [a, add(v[`${a}Content`] as string)])),
    SetManyPlanFields: () => ({}),
    MovePlanItem: (v) => ({ updateProjectV2ItemPosition: move(v.itemId as string, v.afterId as string | null) }),
    MovePlanItems: (v) => Object.fromEntries(aliases(v, "Item").map((a) => [a, move(v[`${a}Item`] as string, v[`${a}After`] as string | null)])),
  });
  const sent = (operation: string) => handlers.calls.map((c) => c.body as { query: string; variables: Record<string, unknown> }).filter((b) => b.query.includes(`mutation ${operation}(`));
  return { ...handlers, order, sent };
}

/** The content ids the AddPlanItems requests added, in the order sent. */
const addedContent = (adds: { variables: Record<string, unknown> }[]) => adds.flatMap((a) => Object.entries(a.variables).filter(([k]) => k.endsWith("Content")).map(([, id]) => id));

test("copyItems adds 20 items per request and orders them as the source", async () => {
  // Project order of octo's #5: 145 down to 101. Every item is Ready; odd ones are sized M; every fifth has a Priority.
  const numbers = Array.from({ length: 45 }, (_, i) => 145 - i);
  const source = numbers.map((n) => ({
    ...movedItem(n, {}, "Ready"),
    size: n % 2 ? { __typename: "ProjectV2ItemFieldSingleSelectValue", name: "M" } : null,
    priority: n % 5 === 0 ? { __typename: "ProjectV2ItemFieldSingleSelectValue", name: "High" } : null,
  }));
  const github = copyGitHub(source);

  const result = await port(github.fetch).copyItems(moved, { login: "octo", number: 5 }, { login: "acme", number: 7 }, ["size"]);

  expect(result).toEqual({ copied: numbers, priorities: numbers.filter((n) => n % 5 === 0) });
  // The adds go 20 a request, in the source order, each valid against GitHub's schema.
  const adds = github.sent("AddPlanItems");
  expect(adds.map((a) => mutationsOf(a.query).length)).toEqual([20, 20, 5]);
  expect(adds.flatMap((a) => mutationsOf(a.query)).every(([, mutation]) => mutation === "addProjectV2ItemById")).toBe(true);
  expect(adds.every((a) => a.variables.projectId === "PVT_7")).toBe(true);
  expect(addedContent(adds)).toEqual(numbers.map((n) => `I_${n}`));
  // Each new item gets its Status and, when it had one, its Size; at most 20 mutations a request.
  const writes = github.sent("SetManyPlanFields");
  expect(writes.every((w) => mutationsOf(w.query).length <= 20)).toBe(true);
  expect(writes.flatMap((w) => mutationsOf(w.query))).toHaveLength(45 + 23);
  const values = Object.assign({}, ...writes.map((w) => w.variables)) as Record<string, unknown>;
  expect(values).toMatchObject({ projectId: "PVT_7", i145Item: "PVTI_new_145", i145_statusField: "F_status", i145_statusValue: "o_ready", i145_sizeField: "F_size", i145_sizeValue: "o_M" });
  expect(values).not.toHaveProperty("i144_sizeField");
  // GitHub put each new item at the top; the moves give the old Project order.
  expect(github.order).toEqual(numbers.map((n) => `PVTI_new_${n}`));
});

test("copyItems skips items of other repositories", async () => {
  const source = [
    movedItem(1, {}, "Done"),
    movedItem(3, { repository: { name: "other", owner: { login: "acme" } } }, "Ready"),
    { id: "PVTI_draft", status: null, content: { __typename: "DraftIssue" } },
    movedItem(2, {}, "Shaping"),
  ];
  const github = copyGitHub(source);

  expect(await port(github.fetch).copyItems(moved, { login: "octo", number: 5 }, { login: "acme", number: 7 }, ["size"])).toEqual({ copied: [1, 2], priorities: [] });
  expect(addedContent(github.sent("AddPlanItems"))).toEqual(["I_1", "I_2"]);
  expect(github.order).toEqual(["PVTI_new_1", "PVTI_new_2"]);

  // A target Project without a field to copy refuses before adding anything.
  const bare = copyGitHub(source, {});
  await expect(port(bare.fetch).copyItems(moved, { login: "octo", number: 5 }, { login: "acme", number: 7 }, ["size"])).rejects.toThrow(
    "GitHub Project #7 of the organization acme has no Size field. Run setup_plan to add it, then copy again.",
  );
  expect(bare.operations.map((o) => o.operation)).toEqual(["PlanItems", "PlanProject"]);
});
