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
    "assign",
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
    "schedule",
    "set_order",
    "set_size",
    "setup_plan",
    "start_run",
    "start_scheduler",
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
    "arrange_plan",
    "get_run",
    "get_run_events",
    "get_scheduler",
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

test("assign is confirm and its summary names who gets the issue, or says it clears them", () => {
  expect(toolSpec("assign")).toMatchObject({ kind: "data", confirm: true, readOnly: false, openWorld: true });
  expect(toolSpec("assign").summarize({ project: "handoff", issue: 16, logins: ["ann"], me: true })).toBe("Assign #16 in handoff to ann, you");
  expect(toolSpec("assign").summarize({ project: "handoff", issue: 16, logins: [] })).toBe("Clear the assignees of #16 in handoff");
});

test("schedule is confirm and its summary names every issue with its dates", () => {
  expect(toolSpec("schedule")).toMatchObject({ kind: "data", confirm: true, readOnly: false, openWorld: true });
  const items = [
    { issue: 57, start: "2026-10-06", target: "2026-10-09" },
    { issue: 58, target: "2026-10-16" },
    { issue: 41, start: null },
  ];
  expect(toolSpec("schedule").summarize({ project: "handoff", items })).toBe(
    "Schedule in handoff: #57 Start 2026-10-06, Target 2026-10-09; #58 Target 2026-10-16; #41 clear Start",
  );
  expect(toolSpec("create_task").summarize({ project: "handoff", story: 41, title: "Add the migration", brief: "b", start: "2026-10-06", target: "2026-10-09" })).toBe(
    "Create task 'Add the migration' under story #41 in handoff, Start 2026-10-06, Target 2026-10-09",
  );
  // The input refuses a date that is not a calendar day written YYYY-MM-DD.
  expect(toolSpec("schedule").input.safeParse({ project: "handoff", items: [{ issue: 57, start: "2026-02-31" }] }).success).toBe(false);
  expect(toolSpec("schedule").input.safeParse({ project: "handoff", items: [] }).success).toBe(false);
});

test("set_size is confirm and its summary names each task with its old and new size and estimate", () => {
  expect(toolSpec("set_size")).toMatchObject({ kind: "data", confirm: true, readOnly: false, openWorld: true, idempotent: true });
  const items = [
    { issue: 57, size: "L", estimate: "3h", was: { size: "M", estimate_hours: null } },
    { issue: 58, estimate: null, was: { size: "S", estimate_hours: 12 } },
    { issue: 59, size: "S", estimate: 4 },
    { issue: 60, size: null },
  ];
  expect(toolSpec("set_size").summarize({ project: "handoff", items })).toBe(
    "Size in handoff: #57 size M to L, estimate none to 3h; #58 estimate 12h to none; #59 size S, estimate 4h; #60 clear size",
  );
  // An item changes its size, its estimate or both; an estimate is hours or days, like 3h or 2d, or a number of hours.
  const parses = (item: Record<string, unknown>) => toolSpec("set_size").input.safeParse({ project: "handoff", items: [{ issue: 57, ...item }] }).success;
  expect(parses({})).toBe(false);
  expect(parses({ size: "XL" })).toBe(false);
  expect(parses({ estimate: "2d" })).toBe(true);
});

test("set_order is confirm and its summary lists each move and pin", () => {
  expect(toolSpec("set_order")).toMatchObject({ kind: "data", confirm: true, readOnly: false, openWorld: true, idempotent: true });
  // With the order it read, the card names each task's old and new place.
  expect(toolSpec("set_order").summarize({ project: "todooverkill", order: [74, 60], was: [60, 61, 74], pin: [74, 61], unpin: [60] })).toBe(
    "Order in todooverkill: #74 Next 3 to Next 1, pinned; #60 Next 1 to Next 3, unpinned; #61 stays Next 2, pinned",
  );
  expect(toolSpec("set_order").summarize({ project: "todooverkill", order: [61, 60], was: [60, 61, 74] })).toBe("Order in todooverkill: #61 Next 2 to Next 1; #60 Next 1 to Next 2");
  // Without it, the card lists the new relative order.
  expect(toolSpec("set_order").summarize({ project: "todooverkill", order: [74, 60], pin: [74] })).toBe("Order in todooverkill: #74, #60 in that order; pin #74");
  expect(toolSpec("set_order").input.safeParse({ project: "todooverkill", order: [] }).success).toBe(false);
});

test("list_github_projects and setup_plan describe the repository owner's Projects, a user's or an organization's", () => {
  const list = toolSpec("list_github_projects").description;
  expect(list).toMatch(/^The GitHub Projects of the repository's owner, a user or an organization, that the token can write, those linked to the project's repository first/);
  expect(list).not.toMatch(/user's own/);
  const setup = toolSpec("setup_plan").description;
  expect(setup).toMatch(/a GitHub Project of the repository's owner, a user or an organization, with the Status columns/);
  expect(setup).toMatch(/project names the Project's owner/);
  expect(setup).not.toMatch(/Project of the user/);
});

test("setup_plan takes copy_from, the old Project of a moved repository, and says Priority is not copied", () => {
  const setup = toolSpec("setup_plan");
  expect(setup.description).toMatch(/repository moved to another owner[^.]*copy_from/);
  expect(setup.description).toMatch(/Priority is not copied/);
  expect(setup.input.safeParse({ project: "web", copy_from: { owner: "Krister-Johansson", number: 5 } }).success).toBe(true);
  expect(setup.input.safeParse({ project: "web", copy_from: { owner: "", number: 5 } }).success).toBe(false);
  expect(setup.input.safeParse({ project: "web", copy_from: { owner: "Krister-Johansson", number: 0 } }).success).toBe(false);
  expect(setup.summarize({ project: "web", copy_from: { owner: "Krister-Johansson", number: 5 } })).toMatch(
    /^Set up the plan of web on GitHub: .*, and copy the items of Krister-Johansson's Project #5 with their Status and fields$/,
  );
  expect(setup.summarize({ project: "web", use: 3, copy_from: { owner: "Krister-Johansson", number: 5 } })).toMatch(
    /^Use GitHub Project #3 as the plan of web: .*, and copy the items of Krister-Johansson's Project #5 with their Status and fields$/,
  );
});

test("start_scheduler names both sources of Priority, the Project's own field first, and get_scheduler says which one it reads", () => {
  const start = toolSpec("start_scheduler").description;
  expect(start).toMatch(/the Project's own Priority field/);
  expect(start).toMatch(/organization's Priority issue field/);
  expect(start).toMatch(/priority order with neither/);
  expect(toolSpec("get_scheduler").description).toMatch(/which Priority field/);
});

test("start_scheduler is confirm and its summary names the project, the limit, the order and the graph", () => {
  expect(toolSpec("start_scheduler")).toMatchObject({ kind: "data", confirm: true, readOnly: false, openWorld: true });
  expect(toolSpec("start_scheduler").summarize({ project: "todooverkill", max_runs: 2, order: "project", graph: "master" })).toBe(
    "Let handoff start up to 2 runs at a time on Ready tasks in todooverkill, in Project order, with graph master",
  );
  expect(toolSpec("start_scheduler").summarize({ project: "todooverkill", max_runs: 1, order: "priority", graph: "master" })).toBe(
    "Let handoff start up to 1 run at a time on Ready tasks in todooverkill, by the Priority field, with graph master",
  );
  // A setting left out keeps its stored value, or its default the first time.
  expect(toolSpec("start_scheduler").summarize({ project: "todooverkill", max_runs: 3 })).toBe(
    "Let handoff start up to 3 runs at a time on Ready tasks in todooverkill, with its other settings as they are (at first: Project order, the default graph)",
  );
  expect(toolSpec("start_scheduler").summarize({ project: "todooverkill" })).toBe(
    "Let handoff start runs on Ready tasks in todooverkill, with its settings as they are (at first: 1 run at a time, Project order, the default graph)",
  );
  expect(toolSpec("start_scheduler").input.safeParse({ project: "todooverkill", max_runs: 11 }).success).toBe(false);
  expect(toolSpec("pause_scheduler")).toMatchObject({ kind: "data", confirm: false, readOnly: false, idempotent: true });
});

test("start_scheduler's summary names the skip label when it changes, and stop_scheduler turns the scheduler off", () => {
  expect(toolSpec("start_scheduler").summarize({ project: "todooverkill", max_runs: 1, order: "project", graph: "master", skip_label: "manual" })).toBe(
    "Let handoff start up to 1 run at a time on Ready tasks in todooverkill, in Project order, with graph master, skipping tasks labelled manual",
  );
  expect(toolSpec("start_scheduler").summarize({ project: "todooverkill", max_runs: 1, order: "project", graph: "master", skip_label: null })).toBe(
    "Let handoff start up to 1 run at a time on Ready tasks in todooverkill, in Project order, with graph master, skipping no label",
  );
  expect(toolSpec("stop_scheduler")).toMatchObject({ kind: "data", confirm: false, readOnly: false, idempotent: true });
  expect(toolSpec("stop_scheduler").summarize({ project: "todooverkill" })).toBe("Turn off the scheduler of todooverkill");
});
