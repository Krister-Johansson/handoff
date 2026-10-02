import { expect, test } from "vitest";
import { parseSettingsTab } from "./settings-tab";

test("the settings tab comes from ?tab=, Projects, the first section, unless another known tab is asked for", () => {
  expect(parseSettingsTab({})).toBe("projects");
  expect(parseSettingsTab({ tab: "appearance" })).toBe("appearance");
  expect(parseSettingsTab({ tab: "notifications" })).toBe("notifications");
  expect(parseSettingsTab({ tab: "agents" })).toBe("agents");
  expect(parseSettingsTab({ tab: "worker" })).toBe("worker");
  expect(parseSettingsTab({ tab: "nope" })).toBe("projects");
  expect(parseSettingsTab({ tab: ["agents"] })).toBe("projects");
});
