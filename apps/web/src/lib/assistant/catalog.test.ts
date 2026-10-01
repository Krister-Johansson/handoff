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
  expect(confirm).toEqual(["add_project", "answer_permission", "answer_question", "cancel_run", "repair_run", "request_merge", "resolve_loop", "run_again", "start_run"]);
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

test("results that carry text from runs or GitHub are marked untrusted", () => {
  expect(CATALOG.filter((t) => t.untrusted).map((t) => t.name).sort()).toEqual(["get_run", "get_run_events", "list_attention", "list_backlog", "list_inbox", "list_notifications"]);
});
