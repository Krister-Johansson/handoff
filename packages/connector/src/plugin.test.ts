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

test("the handoff skill shapes before it starts runs and names setup_plan, create_epic, create_story, create_task and move_to_ready", () => {
  const skill = readFileSync(root("plugins/handoff/skills/handoff/SKILL.md"), "utf8");
  const shape = skill.indexOf("## Shape first");
  expect(shape).toBeGreaterThan(0);
  const section = skill.slice(shape, skill.indexOf("\n## ", shape + 1));
  for (const tool of ["setup_plan", "create_epic", "create_story", "create_task", "move_to_ready"]) expect(section).toContain(tool);
  expect(section.indexOf("move_to_ready")).toBeLessThan(section.indexOf("start_run"));
  expect(shape).toBeLessThan(skill.indexOf("start_run"));
  expect(readFileSync(root("plugins/handoff/skills/handoff-setup/SKILL.md"), "utf8")).toContain("A plan on GitHub Projects");
});

test("the handoff skill schedules Start and Target only when the user asks to plan the timeline", () => {
  const skill = readFileSync(root("plugins/handoff/skills/handoff/SKILL.md"), "utf8");
  const shape = skill.indexOf("## Shape first");
  const section = skill.slice(shape, skill.indexOf("\n## ", shape + 1));
  expect(section).toMatch(/`schedule`[^\n]*Start[^\n]*Target/);
  expect(section).toMatch(/only when the user asks/);
});

test("the handoff skill says a person decides what is Ready and names start_scheduler, pause_scheduler and get_scheduler", () => {
  const skill = readFileSync(root("plugins/handoff/skills/handoff/SKILL.md"), "utf8");
  const start = skill.indexOf("## Let the scheduler start runs");
  expect(start).toBeGreaterThan(skill.indexOf("## Shape first"));
  const section = skill.slice(start, skill.indexOf("\n## ", start + 1));
  expect(section).toMatch(/the user decides what is Ready/i);
  for (const tool of ["start_scheduler", "pause_scheduler", "get_scheduler"]) expect(section).toContain(tool);
});

test("the handoff skill says start_run assigns the user and assign marks who works on an issue", () => {
  const skill = readFileSync(root("plugins/handoff/skills/handoff/SKILL.md"), "utf8");
  expect(skill).toMatch(/`start_run`[^\n]*assign/);
  expect(skill).toMatch(/`assign`[^\n]*`me`/);
  expect(json("plugins/handoff/.claude-plugin/plugin.json").version).toBe("0.7.0");
});

test("the plugin ships a setup skill that walks through setup_project", () => {
  const skill = readFileSync(root("plugins/handoff/skills/handoff-setup/SKILL.md"), "utf8");
  expect(skill).toMatch(/^---\nname: handoff-setup\ndescription: /);
  expect(skill).toContain("setup_project");
  expect(skill).toContain(".claude/launch.json");
});
