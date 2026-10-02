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
    PlanProjectSetup: () => ({ user: { projectV2: userProject(2, "sample plan", statusOptions("Shaping", "Ready", "Running", "In review", "Done", "Parked"), [{ name: "sample", owner: "octo" }]) } }),
  });
  const projects = port(fetch);

  expect(await projects.adoptProject("octo", 2, repo)).toMatchObject({ project: { number: 2, statusOptions: { Shaping: "o_0", Done: "o_4" } }, renamed: [], added: [] });
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

test("getProject reads a user's Project with its Status option ids, and is undefined when GitHub cannot resolve it", async () => {
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
  });
  expect(await projects.getProject("octo", 99)).toBeUndefined();
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
