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

test("set_project_tab builds the tab and filter query the project page reads", () => {
  expect(plan("set_project_tab", { project_id: "p1", tab: "runs" })).toEqual({ kind: "navigate", href: "/projects/p1?tab=runs" });
  expect(plan("set_project_tab", { project_id: "p1", tab: "issues", filter: "started" })).toEqual({ kind: "navigate", href: "/projects/p1?tab=issues&issues=started" });
  expect(plan("set_project_tab", { project_id: "p1", tab: "pulls", filter: "merged" })).toEqual({ kind: "navigate", href: "/projects/p1?tab=pulls&pr=merged" });
  expect(() => plan("set_project_tab", { project_id: "p1", tab: "issues", filter: "merged" })).toThrow(/The issues tab filters by todo, started or all/);
  expect(() => plan("set_project_tab", { project_id: "p1", tab: "graphs", filter: "all" })).toThrow(/The graphs tab has no filter/);
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
