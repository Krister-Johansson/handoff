import { expect, test } from "vitest";
import { FakeGitHub } from "./fake-github.ts";
import { FakeProjects } from "./fake-projects.ts";

const repo = { owner: "octo", name: "sample" };

test("FakeProjects shapes a plan in its Project and shares issue state with FakeGitHub", async () => {
  const github = new FakeGitHub();
  const projects = new FakeProjects(github);
  const project = await projects.createProject("octo", repo, "sample plan");
  await projects.ensureLabels(repo);

  const epic = await projects.createIssue(repo, { project: project.number, title: "Project management", body: "## Goal\nA plan.", labels: ["epic"] });
  const story = await projects.createIssue(repo, { project: project.number, title: "Shaping", body: "## Acceptance criteria", labels: ["story"], parent: epic.number });
  const first = await projects.createIssue(repo, { project: project.number, title: "Add the column", body: "brief", labels: ["task"], parent: story.number });
  const second = await projects.createIssue(repo, { project: project.number, title: "Read the column", body: "brief", labels: ["task"], parent: story.number, blockedBy: [first.number] });

  expect(await projects.setStatus(repo, project.number, first.number, "Ready")).toBe("set");
  // A person drags the second task on GitHub's board to a column handoff does not know.
  projects.itemsOf(repo).get(second.number)!.status = "Todo";
  github.issues.get(first.number)!.state = "closed";

  const items = await projects.listItems("octo", project.number, repo);
  expect(items.map((i) => [i.number, i.kind, i.status, i.parent, i.state, i.blockedBy])).toEqual([
    [epic.number, "epic", "Shaping", undefined, "open", []],
    [story.number, "story", "Shaping", epic.number, "open", []],
    [first.number, "task", "Ready", story.number, "closed", []],
    [second.number, "task", undefined, story.number, "open", []],
  ]);
  expect(items.find((i) => i.number === story.number)!.subIssues).toEqual({ total: 2, completed: 1 });
  expect(await projects.lineage(repo, second.number)).toEqual([
    { number: story.number, title: "Shaping", body: "## Acceptance criteria", kind: "story" },
    { number: epic.number, title: "Project management", body: "## Goal\nA plan.", kind: "epic" },
  ]);

  // An issue filed by hand is not an item until it is added.
  github.issues.set(50, { number: 50, title: "A bug", url: "https://github.com/octo/sample/issues/50", body: "", state: "open" });
  expect(await projects.setStatus(repo, project.number, 50, "Shaping")).toBe("not-in-project");
  expect(await projects.getStatus(repo, project.number, 50)).toBeUndefined();
  expect(await projects.setStatus(repo, project.number, 50, "Shaping", { add: true })).toBe("set");
  expect(await projects.getStatus(repo, project.number, 50)).toBe("Shaping");
});

test("FakeProjects numbers items in the order they joined the Project and reads Priority when the Project has the field", async () => {
  const github = new FakeGitHub();
  const projects = new FakeProjects(github);
  const project = await projects.createProject("octo", repo, "sample plan");
  const first = await projects.createIssue(repo, { project: project.number, title: "First", body: "", labels: ["task"] });
  const second = await projects.createIssue(repo, { project: project.number, title: "Second", body: "", labels: ["task"] });
  expect(project.priorityOptions).toBeUndefined();

  // A person adds a Priority field on GitHub and sets it on the second task.
  projects.plans.get("octo/sample")!.project.priorityOptions = ["P0", "P1", "P2"];
  projects.itemsOf(repo).get(second.number)!.priority = "P0";

  expect((await projects.listItems("octo", project.number, repo)).map((i) => [i.number, i.position, i.priority])).toEqual([
    [first.number, 1, undefined],
    [second.number, 2, "P0"],
  ]);
  expect((await projects.getProject("octo", project.number))?.priorityOptions).toEqual(["P0", "P1", "P2"]);
});

test("FakeProjects keeps Start and Target on items, and a Project without the date fields refuses them until ensureDateFields adds them", async () => {
  const github = new FakeGitHub();
  const projects = new FakeProjects(github);
  const project = await projects.createProject("octo", repo, "sample plan");
  expect(project.dateFields).toEqual({ start: expect.any(String), target: expect.any(String) });

  const task = await projects.createIssue(repo, { project: project.number, title: "Add the column", body: "brief", labels: ["task"], start: "2026-10-06", target: "2026-10-09" });
  expect(await projects.setDates(repo, project.number, task.number, { target: null })).toBe("set");
  expect(await projects.setDates(repo, project.number, 99, { start: "2026-10-06" })).toBe("not-in-project");
  const [item] = await projects.listItems("octo", project.number, repo);
  expect([item?.start, item?.target]).toEqual(["2026-10-06", undefined]);

  // A Project adopted from elsewhere has no date fields until setup adds them.
  projects.plans.get("octo/sample")!.project.dateFields = { start: undefined, target: undefined };
  expect(await projects.setDates(repo, project.number, task.number, { target: "2026-10-09" })).toBe("no-field");
  expect(await projects.ensureDateFields("octo", project.number)).toEqual({ start: expect.any(String), target: expect.any(String) });
  expect(await projects.setDates(repo, project.number, task.number, { target: "2026-10-09" })).toBe("set");
  expect((await projects.getProject("octo", project.number))?.dateFields?.target).toEqual(expect.any(String));
});

test("a plan item's assignees are its issue's on GitHub, with their avatars, so assigning on GitHub shows in the plan", async () => {
  const github = new FakeGitHub();
  const projects = new FakeProjects(github);
  const project = await projects.createProject("octo", repo, "sample plan");
  const task = await projects.createIssue(repo, { project: project.number, title: "Add the column", body: "brief", labels: ["task"] });
  await github.setAssignees(repo, task.number, ["octocat"]);
  expect((await projects.listItems("octo", project.number, repo)).map((i) => i.assignees)).toEqual([[{ login: "octocat", avatarUrl: "https://avatars.githubusercontent.com/u/583231" }]]);
});

test("FakeProjects writes Size, Estimate and dates in one call, reading another Size option or an Estimate of 0 as none", async () => {
  const github = new FakeGitHub();
  const projects = new FakeProjects(github);
  const project = await projects.createProject("octo", repo, "sample plan");
  const first = await projects.createIssue(repo, { project: project.number, title: "First", body: "", labels: ["task"] });
  const second = await projects.createIssue(repo, { project: project.number, title: "Second", body: "", labels: ["task"] });

  // A new Project has no Size or Estimate until setup adds them; nothing is written.
  expect(project.estimateFields).toBeUndefined();
  expect(await projects.setPlanFields(repo, project.number, first.number, { start: "2026-10-06", size: "M" })).toBe("no-field");
  expect(await projects.ensureEstimateFields("octo", project.number)).toEqual({
    size: { id: expect.any(String), options: { S: expect.any(String), M: expect.any(String), L: expect.any(String) } },
    estimate: expect.any(String),
  });

  expect(await projects.setPlanFields(repo, project.number, first.number, { start: "2026-10-06", target: "2026-10-07", size: "M", estimate: 10.5 })).toBe("set");
  expect(await projects.setPlanFields(repo, project.number, 99, { size: "S" })).toBe("not-in-project");
  // A person picks one of the field's own options on GitHub, and types 0 as the estimate.
  projects.itemsOf(repo).get(second.number)!.size = "🦑 Large";
  projects.itemsOf(repo).get(second.number)!.estimate = 0;

  const read = async () => (await projects.listItems("octo", project.number, repo)).map((i) => [i.number, i.start, i.target, i.size, i.estimate]);
  expect(await read()).toEqual([
    [first.number, "2026-10-06", "2026-10-07", "M", 10.5],
    [second.number, undefined, undefined, undefined, undefined],
  ]);

  expect(await projects.setPlanFields(repo, project.number, first.number, { size: null, estimate: null })).toBe("set");
  expect(await read()).toEqual([
    [first.number, "2026-10-06", "2026-10-07", undefined, undefined],
    [second.number, undefined, undefined, undefined, undefined],
  ]);

  // A Size field without L refuses L and changes nothing else.
  projects.plans.get("octo/sample")!.project.estimateFields!.size!.options.L = undefined;
  expect(await projects.setPlanFields(repo, project.number, first.number, { estimate: 3, size: "L" })).toBe("no-option");
  expect((await read())[0]).toEqual([first.number, "2026-10-06", "2026-10-07", undefined, undefined]);
});

test("FakeProjects ensureEstimateFields adds S, M and L to a Size field that lacks them and keeps the ids it has", async () => {
  const projects = new FakeProjects(new FakeGitHub());
  const project = await projects.createProject("octo", repo, "sample plan");
  projects.plans.get("octo/sample")!.project.estimateFields = { size: { id: "F_size", options: { S: undefined, M: "o_M", L: undefined } }, estimate: undefined };

  const ids = await projects.ensureEstimateFields("octo", project.number);
  expect(ids).toEqual({ size: { id: "F_size", options: { S: expect.any(String), M: "o_M", L: expect.any(String) } }, estimate: expect.any(String) });
  expect(await projects.ensureEstimateFields("octo", project.number)).toEqual(ids);
  expect((await projects.getProject("octo", project.number))?.estimateFields).toEqual(ids);
});

test("FakeProjects creates a Project without date fields and only the Size field when asked, as a Flow project's setup does", async () => {
  const projects = new FakeProjects(new FakeGitHub());
  const project = await projects.createProject("octo", repo, "sample plan", { dateFields: false });
  expect(project.dateFields).toEqual({ start: undefined, target: undefined });
  expect(await projects.ensureEstimateFields("octo", project.number, { estimate: false })).toEqual({
    size: { id: expect.any(String), options: { S: expect.any(String), M: expect.any(String), L: expect.any(String) } },
    estimate: undefined,
  });
  expect((await projects.getProject("octo", project.number))?.estimateFields?.estimate).toBeUndefined();
});

test("moveItems reorders listItems", async () => {
  const projects = new FakeProjects(new FakeGitHub());
  const project = await projects.createProject("octo", repo, "sample plan");
  const tasks: number[] = [];
  for (const title of ["First", "Second", "Third", "Fourth"]) tasks.push((await projects.createIssue(repo, { project: project.number, title, body: "", labels: ["task"] })).number);
  const [first, second, third, fourth] = tasks as [number, number, number, number];
  const read = async () => (await projects.listItems("octo", project.number, repo)).map((i) => [i.number, i.position, i.itemId]);
  const before = await read();
  const id = (issue: number) => before.find(([n]) => n === issue)![2] as string;
  expect(new Set(before.map(([, , itemId]) => itemId)).size).toBe(4);

  // The fourth goes to the top, then the first after the third, one move after another.
  await projects.moveItems("octo", project.number, [
    { itemId: id(fourth), afterId: null },
    { itemId: id(first), afterId: id(third) },
  ]);
  expect(await read()).toEqual([
    [fourth, 1, id(fourth)],
    [second, 2, id(second)],
    [third, 3, id(third)],
    [first, 4, id(first)],
  ]);

  // An item that is not in the Project throws, and the moves before it stay, as on GitHub.
  await expect(projects.moveItems("octo", project.number, [{ itemId: id(second), afterId: null }, { itemId: "PVTI_gone", afterId: null }])).rejects.toThrow(/moved 1 of 2/);
  expect((await read()).map(([n]) => n)).toEqual([second, fourth, third, first]);
});
