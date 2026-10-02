import { expect, test } from "vitest";
import { fakeGraphql } from "../testing/fake-fetch.ts";
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
      assignees: { nodes: [{ login: "ann" }] },
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
      assignees: ["ann"],
      subIssues: { total: 0, completed: 0 },
      blockedBy: [3],
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
const planProject = (number: number, ownerId = "U_octo") => ({ id: `PVT_${number}`, number, owner: { id: ownerId }, field: statusField });

/** The IssuePlan answer for an issue that is an item of the given Projects. */
function issuePlan(number: number, items: { id: string; project: ReturnType<typeof planProject>; status?: string }[], over: Record<string, unknown> = {}) {
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

test("createProject creates a user Project, renames the Status options keeping Done, links the repository and returns the option ids", async () => {
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
    LinkPlanRepository: () => ({ linkProjectV2ToRepository: { repository: { id: "R_sample" } } }),
  });
  const projects = port(fetch);

  expect(await projects.createProject("octo", repo, "sample plan")).toEqual({
    number: 9,
    url: "https://github.com/users/octo/projects/9",
    title: "sample plan",
    statusOptions: { Shaping: "o_s", Ready: "o_r", Running: "o_run", "In review": "o_rev", Done: "o_done" },
  });
  expect(operations.map((o) => o.operation)).toEqual(["PlanOwnerIds", "CreatePlanProject", "SetStatusOptions", "LinkPlanRepository"]);
  expect(operations[0]!.variables).toEqual({ login: "octo", owner: "octo", name: "sample" });
  expect(operations[1]!.variables).toEqual({ ownerId: "U_octo", title: "sample plan" });
  const options = (operations[2]!.variables.options as { id?: string; name: string; color: string; description: string }[]).map(({ id, name, color, description }) => ({ id, name, color, description }));
  expect(operations[2]!.variables.fieldId).toBe("F_status");
  expect(options.map((o) => o.name)).toEqual(["Shaping", "Ready", "Running", "In review", "Done"]);
  // Done keeps its option id, colour and description, so GitHub's "Item closed" workflow still finds it.
  expect(options[4]).toEqual({ id: "o_done", name: "Done", color: "PURPLE", description: "This has been completed" });
  expect(options.slice(0, 4).every((o) => o.id === undefined)).toBe(true);
  expect(operations[3]!.variables).toEqual({ projectId: "PVT_9", repositoryId: "R_sample" });
});

test("setStatus reports no-option when the Project's Status has no such option", async () => {
  const todoOnly = { ...planProject(3), field: { ...statusField, options: [{ id: "o_todo", name: "Todo" }] } };
  const { fetch, operations } = fakeGraphql({ IssuePlan: () => issuePlan(12, [{ id: "PVTI_3", project: todoOnly }]) });
  const projects = port(fetch);

  expect(await projects.setStatus(repo, 3, 12, "Ready")).toBe("no-option");
  expect(operations.map((o) => o.operation)).toEqual(["IssuePlan"]);
});
