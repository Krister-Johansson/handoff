import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { ProjectSettingsNav, SettingsNav } from "./settings-nav";

const links = (nav: HTMLElement) => within(nav).getAllByRole("link").map((l) => [l.textContent, l.getAttribute("href")]);

test("the side navigation links every section by ?tab= and marks the open one", () => {
  render(<SettingsNav active="notifications" />);
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  expect(links(nav)).toEqual([
    ["Projects", "/settings?tab=projects"],
    ["Skills", "/settings?tab=skills"],
    ["Agents", "/settings?tab=subagents"],
    ["MCP servers", "/settings?tab=mcp"],
    ["Groups", "/settings?tab=groups"],
    ["Appearance", "/settings?tab=appearance"],
    ["Notifications", "/settings?tab=notifications"],
    ["Voice", "/settings?tab=voice"],
    ["Claude Code", "/settings?tab=agents"],
    ["Assistant", "/settings?tab=assistant"],
    ["Worker", "/settings?tab=worker"],
  ]);
  expect(within(nav).getByRole("link", { name: "Notifications" })).toHaveAttribute("aria-current", "page");
  expect(within(nav).getByRole("link", { name: "Appearance" })).not.toHaveAttribute("aria-current");
  expect(within(nav).getByText("Integrations")).toBeInTheDocument();
});

test("the library is a group of Settings after Projects, one section per kind", () => {
  render(<SettingsNav active="mcp" />);
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  const library = within(nav).getByRole("group", { name: "Library" });
  expect(links(library).map(([label]) => label)).toEqual(["Skills", "Agents", "MCP servers", "Groups"]);
  expect(within(library).getByRole("link", { name: "MCP servers" })).toHaveAttribute("aria-current", "page");
});

test("project settings has Runs with Graphs and Default library, and Plan with the Scheduler and Estimates", () => {
  render(<ProjectSettingsNav projectId="p1" active="library" />);
  const nav = screen.getByRole("navigation", { name: "Project settings sections" });
  expect(links(within(nav).getByRole("group", { name: "Runs" }))).toEqual([
    ["Graphs", "/projects/p1/settings?tab=graphs"],
    ["Default library", "/projects/p1/settings?tab=library"],
  ]);
  expect(links(within(nav).getByRole("group", { name: "Plan" }))).toEqual([
    ["Scheduler", "/projects/p1/settings?tab=scheduler"],
    ["Estimates", "/projects/p1/settings?tab=estimates"],
  ]);
  expect(within(nav).getByRole("link", { name: "Default library" })).toHaveAttribute("aria-current", "page");
  expect(within(nav).getByRole("link", { name: "Graphs" })).not.toHaveAttribute("aria-current");
});
