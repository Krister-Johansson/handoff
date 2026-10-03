import { expect, test } from "vitest";
import { libraryRedirectPath, parseProjectSettingsTab, parseSettingsTab, projectSettingsPath, projectSettingsTabLabel, settingsPath } from "./settings-tab";

test("the settings tab comes from ?tab=, Projects, the first section, unless another known tab is asked for", () => {
  expect(parseSettingsTab({})).toBe("projects");
  expect(parseSettingsTab({ tab: "appearance" })).toBe("appearance");
  expect(parseSettingsTab({ tab: "notifications" })).toBe("notifications");
  expect(parseSettingsTab({ tab: "agents" })).toBe("agents");
  expect(parseSettingsTab({ tab: "worker" })).toBe("worker");
  expect(parseSettingsTab({ tab: "nope" })).toBe("projects");
  expect(parseSettingsTab({ tab: ["agents"] })).toBe("projects");
});

test("the library's four kinds are settings tabs; subagents has its own, since agents is Claude Code", () => {
  expect(parseSettingsTab({ tab: "skills" })).toBe("skills");
  expect(parseSettingsTab({ tab: "subagents" })).toBe("subagents");
  expect(parseSettingsTab({ tab: "mcp" })).toBe("mcp");
  expect(parseSettingsTab({ tab: "groups" })).toBe("groups");
  expect(settingsPath("mcp")).toBe("/settings?tab=mcp");
});

test("an old /library link lands on its section of Settings, with the search kept", () => {
  expect(libraryRedirectPath({})).toBe("/settings?tab=skills");
  expect(libraryRedirectPath({ tab: "skills" })).toBe("/settings?tab=skills");
  expect(libraryRedirectPath({ tab: "mcp" })).toBe("/settings?tab=mcp");
  expect(libraryRedirectPath({ tab: "agents" })).toBe("/settings?tab=subagents");
  expect(libraryRedirectPath({ tab: "groups", q: "react" })).toBe("/settings?tab=groups&q=react");
  expect(libraryRedirectPath({ tab: "nope", q: ["a", "b"] })).toBe("/settings?tab=skills");
});

test("the project settings tab comes from ?tab=, Graphs, the first section, unless another known tab is asked for", () => {
  expect(parseProjectSettingsTab({})).toBe("graphs");
  expect(parseProjectSettingsTab({ tab: "library" })).toBe("library");
  expect(parseProjectSettingsTab({ tab: "scheduler" })).toBe("scheduler");
  expect(parseProjectSettingsTab({ tab: "nope" })).toBe("graphs");
  expect(parseProjectSettingsTab({ tab: ["library"] })).toBe("graphs");
  expect(projectSettingsPath("p1")).toBe("/projects/p1/settings");
  expect(projectSettingsPath("p1", "graphs")).toBe("/projects/p1/settings?tab=graphs");
});

test("the estimates section is Estimates in a Timeline project and Plan budget in a Flow project; the other names keep to every mode", () => {
  expect(projectSettingsTabLabel("estimates", "timeline")).toBe("Estimates");
  expect(projectSettingsTabLabel("estimates", "flow")).toBe("Plan budget");
  expect(projectSettingsTabLabel("scheduler", "flow")).toBe("Scheduler");
  expect(projectSettingsTabLabel("library", "timeline")).toBe("Default library");
});
