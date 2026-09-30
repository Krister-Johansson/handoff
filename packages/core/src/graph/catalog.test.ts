import { expect, test } from "vitest";
import { nodeCatalog } from "./catalog.ts";

test("the planner may look at the repository's git history, but not change anything or run other commands", () => {
  const tools = nodeCatalog.planner.allowedTools;
  expect(tools).toEqual(expect.arrayContaining(["Read", "Glob", "Grep", "Bash(git log *)", "Bash(git show *)", "Bash(git diff *)", "Bash(git status *)", "Bash(git ls-files *)"]));
  expect(tools).not.toContain("Bash");
  expect(tools).not.toContain("Edit");
  expect(tools).not.toContain("Write");
  expect(tools.filter((t) => t.startsWith("Bash(") && !t.startsWith("Bash(git "))).toEqual([]);
});
