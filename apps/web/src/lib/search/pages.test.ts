import { expect, test } from "vitest";
import { searchPages } from "./pages";
import type { SearchProject } from "./types";

const handoff: SearchProject = { id: "p1", name: "handoff", repo: "octo/handoff", planMode: "timeline", current: true };
const shop: SearchProject = { id: "p2", name: "shop", repo: "acme/shop", planMode: "flow", current: false };

test("pages are the current project's routes and settings sections, the pages of all projects, Settings with its sections, and each project by name", () => {
  const pages = searchPages([handoff, shop]);
  const row = (label: string) => pages.find((p) => p.label === label);

  expect(pages.map((p) => [p.label, p.trail, p.href])).toEqual([
    ["Home", "handoff", "/projects/p1"],
    ["Runs", "handoff", "/projects/p1/runs"],
    ["Plan", "handoff", "/projects/p1/plan"],
    ["Issues", "handoff", "/projects/p1/issues"],
    ["Pull requests", "handoff", "/projects/p1/pulls"],
    ["Project settings", "handoff", "/projects/p1/settings"],
    ["Graphs", "handoff › Project settings", "/projects/p1/settings?tab=graphs"],
    ["Default library", "handoff › Project settings", "/projects/p1/settings?tab=library"],
    ["App launch", "handoff › Project settings", "/projects/p1/settings?tab=launch"],
    ["Plan mode", "handoff › Project settings", "/projects/p1/settings?tab=mode"],
    ["Scheduler", "handoff › Project settings", "/projects/p1/settings?tab=scheduler"],
    ["Estimates", "handoff › Project settings", "/projects/p1/settings?tab=estimates"],
    ["Inbox", "All projects", "/inbox"],
    ["Chats", "All projects", "/chats"],
    ["Notifications", "All projects", "/notifications"],
    ["Settings", "All projects", "/settings"],
    ["Projects", "Settings", "/settings?tab=projects"],
    ["Skills", "Settings › Library", "/settings?tab=skills"],
    ["Agents", "Settings › Library", "/settings?tab=subagents"],
    ["MCP servers", "Settings › Library", "/settings?tab=mcp"],
    ["Groups", "Settings › Library", "/settings?tab=groups"],
    ["Appearance", "Settings › Preferences", "/settings?tab=appearance"],
    ["Notifications", "Settings › Preferences", "/settings?tab=notifications"],
    ["Voice", "Settings › Preferences", "/settings?tab=voice"],
    ["Claude Code", "Settings › Integrations", "/settings?tab=agents"],
    ["Assistant", "Settings › Integrations", "/settings?tab=assistant"],
    ["Worker", "Settings", "/settings?tab=worker"],
    ["handoff", "Project · octo/handoff", "/projects/p1"],
    ["shop", "Project · acme/shop", "/projects/p2"],
  ]);
  expect(row("Runs")!.projectId).toBe("p1");
  expect(row("Inbox")!.projectId).toBeNull();
  expect(row("shop")!.projectId).toBe("p2");
  expect(new Set(pages.map((p) => p.id)).size).toBe(pages.length);
});

test("a Flow project's estimates section is Plan budget", () => {
  const pages = searchPages([{ ...handoff, planMode: "flow" }]);
  expect(pages.find((p) => p.href.endsWith("tab=estimates"))!.label).toBe("Plan budget");
});

test("without a project, pages hold only those of all projects and Settings", () => {
  const pages = searchPages([{ ...shop, current: false }]);
  expect(pages[0]!.label).toBe("Inbox");
  expect(pages.at(-1)!.label).toBe("shop");
});
