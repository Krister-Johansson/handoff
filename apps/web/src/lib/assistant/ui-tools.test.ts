import { expect, test } from "vitest";
import { CATALOG } from "./catalog";
import { planUiTool, UI_TOOL_NAMES } from "./ui-tools";

const origin = "http://127.0.0.1:3000";
const plan = (name: string, args: unknown) => planUiTool(name, args, origin);

test("go_to accepts a dashboard path or the dashboard's absolute URL and refuses any other origin or an unknown route", () => {
  expect(plan("go_to", { path: "/inbox" })).toEqual({ kind: "navigate", href: "/inbox" });
  expect(plan("go_to", { path: "/projects/p1?tab=issues&issues=all" })).toEqual({ kind: "navigate", href: "/projects/p1?tab=issues&issues=all" });
  expect(plan("go_to", { path: `${origin}/projects/p1/runs/r1/review/q1` })).toEqual({ kind: "navigate", href: "/projects/p1/runs/r1/review/q1" });
  expect(plan("go_to", { path: "/library/skills-sh/vercel/skills" })).toEqual({ kind: "navigate", href: "/library/skills-sh/vercel/skills" });
  expect(plan("go_to", { path: "/settings/" })).toEqual({ kind: "navigate", href: "/settings" });

  expect(() => plan("go_to", { path: "https://example.com/inbox" })).toThrow(/only opens pages of this dashboard/);
  expect(() => plan("go_to", { path: "//example.com/inbox" })).toThrow(/only opens pages of this dashboard/);
  expect(() => plan("go_to", { path: "javascript:alert(1)" })).toThrow(/only opens pages of this dashboard/);
  expect(() => plan("go_to", { path: "http://localhost:3000/inbox" })).toThrow(/only opens pages of this dashboard/);
  expect(() => plan("go_to", { path: "/api/assistant/conversations" })).toThrow(/no page/);
  expect(() => plan("go_to", { path: "/projects/p1/nowhere" })).toThrow(/no page/);
});

test("go_to_inbox narrows to a project by id", () => {
  expect(plan("go_to_inbox", {})).toEqual({ kind: "navigate", href: "/inbox" });
  expect(plan("go_to_inbox", { project_id: "0b6c-1" })).toEqual({ kind: "navigate", href: "/inbox?project=0b6c-1" });
});

test("set_project_tab navigates to the tab's route", () => {
  expect(plan("set_project_tab", { project_id: "p1", tab: "runs" })).toEqual({ kind: "navigate", href: "/projects/p1/runs" });
  expect(plan("set_project_tab", { project_id: "p1", tab: "plan" })).toEqual({ kind: "navigate", href: "/projects/p1/plan" });
  expect(plan("set_project_tab", { project_id: "p1", tab: "settings" })).toEqual({ kind: "navigate", href: "/projects/p1/settings" });
  expect(plan("set_project_tab", { project_id: "p1", tab: "issues", filter: "started" })).toEqual({ kind: "navigate", href: "/projects/p1/issues?issues=started" });
  expect(plan("set_project_tab", { project_id: "p1", tab: "pulls", filter: "merged" })).toEqual({ kind: "navigate", href: "/projects/p1/pulls?pr=merged" });
  for (const path of ["/projects/p1/runs", "/projects/p1/plan", "/projects/p1/issues?issues=all", "/projects/p1/pulls", "/projects/p1/graphs", "/projects/p1/settings"]) {
    expect(plan("go_to", { path })).toEqual({ kind: "navigate", href: path });
  }
  expect(() => plan("set_project_tab", { project_id: "p1", tab: "issues", filter: "merged" })).toThrow(/The issues tab filters by todo, started or all/);
  expect(() => plan("set_project_tab", { project_id: "p1", tab: "graphs", filter: "all" })).toThrow(/The graphs tab has no filter/);
});

test("go_to_plan opens the tab with a view, an epic or a status", () => {
  expect(plan("go_to_plan", { project_id: "p1" })).toEqual({ kind: "navigate", href: "/projects/p1/plan" });
  expect(plan("go_to_plan", { project_id: "p1", view: "board" })).toEqual({ kind: "navigate", href: "/projects/p1/plan?view=board" });
  expect(plan("go_to_plan", { project_id: "p1", epic: 12, status: ["Ready", "In review"] })).toEqual({ kind: "navigate", href: "/projects/p1/plan?epic=12&status=Ready,In%20review" });
  expect(plan("go_to_plan", { project_id: "p1", run: "needs-you" })).toEqual({ kind: "navigate", href: "/projects/p1/plan?run=needs-you" });
  expect(plan("go_to", { path: "/projects/p1/plan?view=board" })).toEqual({ kind: "navigate", href: "/projects/p1/plan?view=board" });
  expect(() => plan("go_to_plan", { project_id: "p1", status: ["Blocked"] })).toThrow(/not valid/);
  expect(() => plan("go_to_plan", { project_id: "../settings" })).toThrow(/is not an id/);
});

test("the notifications, run, review and Try it tools open their pages, and an id that is not one is refused", () => {
  expect(plan("go_to_notifications", { filter: "unread" })).toEqual({ kind: "navigate", href: "/notifications?show=unread" });
  expect(plan("go_to_notifications", {})).toEqual({ kind: "navigate", href: "/notifications" });
  expect(plan("go_to_run", { run_id: "r1" })).toEqual({ kind: "navigate", href: "/runs/r1" });
  expect(plan("go_to_review", { run_id: "r1", question_id: "q1" })).toEqual({ kind: "navigate", href: "/runs/r1/review/q1" });
  expect(plan("go_to_try_it", { run_id: "r1", question_id: "q1" })).toEqual({ kind: "navigate", href: "/runs/r1/try/q1" });
  expect(() => plan("go_to_run", { run_id: "../settings" })).toThrow(/is not an id/);
  expect(plan("where_am_i", {})).toEqual({ kind: "where" });
});

test("every UI tool is a ui entry of the catalog that runs without asking", () => {
  const ui = CATALOG.filter((t) => t.kind === "ui");
  expect(ui.map((t) => t.name).sort()).toEqual([...UI_TOOL_NAMES].sort());
  for (const t of ui) expect({ name: t.name, confirm: t.confirm, readOnly: t.readOnly }).toEqual({ name: t.name, confirm: false, readOnly: true });
});
