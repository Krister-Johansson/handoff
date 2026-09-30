import { expect, test } from "vitest";
import { parseSettingsTab } from "./settings-tab";

test("the settings tab comes from ?tab=, appearance unless another known tab is asked for", () => {
  expect(parseSettingsTab({})).toBe("appearance");
  expect(parseSettingsTab({ tab: "notifications" })).toBe("notifications");
  expect(parseSettingsTab({ tab: "agents" })).toBe("agents");
  expect(parseSettingsTab({ tab: "nope" })).toBe("appearance");
  expect(parseSettingsTab({ tab: ["agents"] })).toBe("appearance");
});
