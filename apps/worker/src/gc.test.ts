import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { dashboardAssistantHome } from "./gc.ts";

const web = fileURLToPath(new URL("../../web", import.meta.url));

test("gc finds the assistant's folder where the dashboard keeps it, whatever folder the CLI runs in", () => {
  expect(dashboardAssistantHome("/srv/handoff")).toBe("/srv/handoff/assistant");
  // The dashboard runs in apps/web, so a relative HANDOFF_HOME is under it.
  expect(dashboardAssistantHome("./.handoff")).toBe(resolve(web, ".handoff", "assistant"));
  expect(dashboardAssistantHome(undefined)).toBe(join(homedir(), ".handoff", "assistant"));
});
