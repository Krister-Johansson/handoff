import { expect, test } from "vitest";
import { z } from "zod";
import { CATALOG, toolSpec } from "./catalog";

test("every tool has a name, a title, a description and an input the browser can register as JSON Schema", () => {
  expect(CATALOG.length).toBeGreaterThan(20);
  expect(new Set(CATALOG.map((t) => t.name)).size).toBe(CATALOG.length);
  for (const spec of CATALOG) {
    expect(spec.name).toMatch(/^[a-z][a-z_]*$/);
    expect(spec.title.length).toBeGreaterThan(3);
    expect(spec.description.length).toBeGreaterThan(20);
    expect(z.toJSONSchema(spec.input)).toMatchObject({ type: "object" });
  }
});

test("tools that change state are marked confirm and never read only", () => {
  const confirm = CATALOG.filter((t) => t.confirm).map((t) => t.name).sort();
  expect(confirm).toEqual([
    "add_project",
    "answer_permission",
    "answer_question",
    "cancel_run",
    "create_epic",
    "create_story",
    "create_task",
    "move_to_ready",
    "move_to_shaping",
    "plan_issue",
    "repair_run",
    "request_merge",
    "resolve_loop",
    "run_again",
    "setup_plan",
    "start_run",
  ]);
  for (const spec of CATALOG) if (spec.confirm) expect(spec.readOnly).toBe(false);
  expect(toolSpec("dismiss_attention")).toMatchObject({ confirm: false, readOnly: false });
  expect(toolSpec("list_runs")).toMatchObject({ confirm: false, readOnly: true });
});

test("summarize names the run and the project for request_merge and cancel_run", () => {
  expect(toolSpec("request_merge").summarize({ run_id: "7f3a1b2c-0000-4000-8000-000000000000" })).toBe("Merge the pull request of run 7f3a1b2c");
  expect(toolSpec("request_merge").summarize({ project: "sandbox", all: true })).toBe("Merge every ready pull request in sandbox, in queue order");
  expect(toolSpec("cancel_run").summarize({ run_id: "7f3a1b2c-0000-4000-8000-000000000000", reason: "wrong issue" })).toBe("Cancel run 7f3a1b2c: wrong issue");
  expect(toolSpec("start_run").summarize({ project: "sandbox", issues: [10, 12] })).toBe("Start a run in sandbox on #10, #12");
  expect(toolSpec("answer_permission").summarize({ request_id: "x", decision: "deny", message: "use Read" })).toBe("Deny the permission request: use Read");
});

test("toolSpec also finds a page tool by name, so a stored page tool call keeps its title and summary", () => {
  expect(toolSpec("page_submit_review")).toMatchObject({ kind: "page", title: "Submit the review", confirm: true });
  expect(toolSpec("page_show_view").summarize({ view: "graph" })).toBe("Show the graph view");
  expect(() => toolSpec("page_nothing")).toThrow("There is no tool page_nothing.");
});

test("results that carry text from runs or GitHub are marked untrusted", () => {
  expect(CATALOG.filter((t) => t.untrusted).map((t) => t.name).sort()).toEqual([
    "get_run",
    "get_run_events",
    "list_attention",
    "list_backlog",
    "list_github_projects",
    "list_inbox",
    "list_notifications",
    "list_plan",
  ]);
});

test("shaping writes are confirm and openWorld and their summaries name the kind, the title and the parent", () => {
  for (const name of ["setup_plan", "create_epic", "create_story", "create_task", "move_to_ready", "move_to_shaping", "plan_issue"]) {
    expect(toolSpec(name)).toMatchObject({ kind: "data", confirm: true, readOnly: false, openWorld: true });
  }
  expect(toolSpec("create_epic").summarize({ project: "handoff", title: "Project management", goal: "A plan." })).toBe("Create epic 'Project management' in handoff");
  expect(toolSpec("create_story").summarize({ project: "handoff", epic: 12, title: "Shaping with the assistant", acceptance: ["x"] })).toBe(
    "Create story 'Shaping with the assistant' under epic #12 in handoff",
  );
  expect(toolSpec("create_task").summarize({ project: "handoff", story: 41, title: "Add the migration", brief: "b" })).toBe("Create task 'Add the migration' under story #41 in handoff");
  expect(toolSpec("create_task").summarize({ project: "handoff", story: 41, title: "Add the migration", brief: "b", blocked_by: [55, 56] })).toBe(
    "Create task 'Add the migration' under story #41 in handoff, blocked by #55, #56",
  );
  expect(toolSpec("plan_issue").summarize({ project: "handoff", issue: 300, story: 41 })).toBe("Plan #300 as a task under story #41 in handoff");
  expect(toolSpec("move_to_ready").summarize({ project: "handoff", issues: [57, 58] })).toBe("Move tasks #57, #58 to Ready in handoff");
  expect(toolSpec("move_to_shaping").summarize({ project: "handoff", issues: [57] })).toBe("Move task #57 back to Shaping in handoff");
  expect(toolSpec("setup_plan").summarize({ project: "handoff", use: 3 })).toMatch(/^Use GitHub Project #3 as the plan of handoff/);
  expect(toolSpec("list_plan")).toMatchObject({ confirm: false, readOnly: true, untrusted: true });
});
