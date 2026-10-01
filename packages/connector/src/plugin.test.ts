import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const json = (path: string) => JSON.parse(readFileSync(root(path), "utf8"));

test("the marketplace lists the handoff plugin from this repository", () => {
  expect(json(".claude-plugin/marketplace.json")).toMatchObject({ name: "handoff", plugins: [{ name: "handoff", source: "./plugins/handoff" }] });
});

test("the plugin starts the bundled bridge with its settings and declares it a channel", () => {
  const plugin = json("plugins/handoff/.claude-plugin/plugin.json");
  expect(plugin.userConfig.token).toMatchObject({ sensitive: true, required: true });
  expect(plugin.mcpServers.handoff).toEqual({
    command: "node",
    args: ["${CLAUDE_PLUGIN_ROOT}/server/handoff-mcp.mjs"],
    env: { HANDOFF_URL: "${user_config.url}", HANDOFF_TOKEN: "${user_config.token}" },
  });
  expect(plugin.channels).toEqual([{ server: "handoff" }]);
  expect(existsSync(root("plugins/handoff/server/handoff-mcp.mjs"))).toBe(true);
  expect(readFileSync(root("plugins/handoff/skills/handoff/SKILL.md"), "utf8")).toMatch(/^---\nname: handoff\ndescription: /);
});

test("the plugin ships a setup skill that walks through setup_project", () => {
  const skill = readFileSync(root("plugins/handoff/skills/handoff-setup/SKILL.md"), "utf8");
  expect(skill).toMatch(/^---\nname: handoff-setup\ndescription: /);
  expect(skill).toContain("setup_project");
  expect(skill).toContain(".claude/launch.json");
});
