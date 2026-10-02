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
