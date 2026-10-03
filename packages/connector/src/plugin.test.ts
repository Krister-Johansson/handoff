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

test("the handoff skill names set_size and arrange_plan", () => {
  const skill = readFileSync(root("plugins/handoff/skills/handoff/SKILL.md"), "utf8");
  const shape = skill.indexOf("## Shape first");
  const section = skill.slice(shape, skill.indexOf("\n## ", shape + 1));
  expect(section).toMatch(/`set_size`[^\n]*when the user sizes/);
  expect(section).toMatch(/`arrange_plan`[^\n]*`schedule`/);
  expect(section.indexOf("`arrange_plan`")).toBeLessThan(section.lastIndexOf("`schedule`"));
});

test("the handoff skill says a person decides what is Ready and names start_scheduler, pause_scheduler, stop_scheduler and get_scheduler", () => {
  const skill = readFileSync(root("plugins/handoff/skills/handoff/SKILL.md"), "utf8");
  const start = skill.indexOf("## Let the scheduler start runs");
  expect(start).toBeGreaterThan(skill.indexOf("## Shape first"));
  const section = skill.slice(start, skill.indexOf("\n## ", start + 1));
  expect(section).toMatch(/the user decides what is Ready/i);
  for (const tool of ["start_scheduler", "pause_scheduler", "stop_scheduler", "get_scheduler"]) expect(section).toContain(tool);
});

test("the handoff skill says only a failed run or a permission request holds the scheduler, and a waiting review counts toward the limit", () => {
  const skill = readFileSync(root("plugins/handoff/skills/handoff/SKILL.md"), "utf8");
  const start = skill.indexOf("## Let the scheduler start runs");
  const section = skill.slice(start, skill.indexOf("\n## ", start + 1));
  expect(section).toMatch(/a failed run or a permission request holds the project/);
  expect(section).toMatch(/review[^\n]*does not hold the project[^\n]*counts toward the limit/);
});

test("the handoff skill says start_run assigns the user and assign marks who works on an issue", () => {
  const skill = readFileSync(root("plugins/handoff/skills/handoff/SKILL.md"), "utf8");
  expect(skill).toMatch(/`start_run`[^\n]*assign/);
  expect(skill).toMatch(/`assign`[^\n]*`me`/);
});

test("the handoff skill says get_run has the whole command of a permission prompt, and how a review and a Try it gate are answered", () => {
  const skill = readFileSync(root("plugins/handoff/skills/handoff/SKILL.md"), "utf8");
  expect(skill).toMatch(/permission prompt[^\n]*whole command[^\n]*`answer_permission`/);
  expect(skill).toMatch(/approve, changes or fix/);
  expect(skill).toMatch(/Try it gate[^\n]*`criteria`/);
});

test("the handoff skill says run_again starts from the branch or from scratch and supersedes the run", () => {
  const skill = readFileSync(root("plugins/handoff/skills/handoff/SKILL.md"), "utf8");
  expect(skill).toMatch(/`run_again`[^\n]*supersedes[^\n]*`from: "branch"`[^\n]*`from: "scratch"`/);
});

test("the handoff skill says a code review sends its Fix now findings with answer_question", () => {
  const skill = readFileSync(root("plugins/handoff/skills/handoff/SKILL.md"), "utf8");
  expect(skill).toMatch(/`answer_question`[^\n]*`fix_now`[^\n]*`findings`/);
});

test("the handoff skill says a Flow project has no dates and names arrange_plan and set_order", () => {
  const skill = readFileSync(root("plugins/handoff/skills/handoff/SKILL.md"), "utf8");
  const shape = skill.indexOf("## Shape first");
  const section = skill.slice(shape, skill.indexOf("\n## ", shape + 1));
  const flow = section.split("\n").find((line) => line.includes("Flow mode"));
  expect(flow).toMatch(/no dates/);
  expect(flow).toMatch(/`arrange_plan`[^\n]*`set_order`/);
  expect(flow).toMatch(/`set_order`[^\n]*`pin`/);
  expect(section).toMatch(/`get_project`[^\n]*plan mode|plan mode[^\n]*`get_project`/);
  expect(readFileSync(root("plugins/handoff/skills/handoff-setup/SKILL.md"), "utf8")).toMatch(/Flow project[^\n]*Size/);
});

test("the plugin is 0.17.0, whose bridge announces new dashboard tools and reports its version", () => {
  expect(json("plugins/handoff/.claude-plugin/plugin.json").version).toBe("0.17.0");
});

test("both skills send the user to Project settings, Graphs for a graph, and arrange_plan takes a story and issues in Timeline mode too", () => {
  const skill = readFileSync(root("plugins/handoff/skills/handoff/SKILL.md"), "utf8");
  const setup = readFileSync(root("plugins/handoff/skills/handoff-setup/SKILL.md"), "utf8");
  for (const text of [skill, setup]) {
    expect(text).not.toContain("Settings tab");
    expect(text).toContain("Project settings, Graphs");
  }
  const dates = skill.split("\n").find((line) => line.includes("only in Timeline mode"));
  expect(dates).toContain("`arrange_plan` (optionally for an epic, a story or some issues)");
});

test("the plugin ships a setup skill that walks through setup_project", () => {
  const skill = readFileSync(root("plugins/handoff/skills/handoff-setup/SKILL.md"), "utf8");
  expect(skill).toMatch(/^---\nname: handoff-setup\ndescription: /);
  expect(skill).toContain("setup_project");
  expect(skill).toContain(".claude/launch.json");
});
