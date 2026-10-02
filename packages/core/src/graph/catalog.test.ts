import { expect, test } from "vitest";
import { nodeCatalog } from "./catalog.ts";

test("the planner may look at the repository's git history, but not change anything or run other commands", () => {
  const tools = nodeCatalog.planner.allowedTools;
  expect(tools).toEqual(expect.arrayContaining(["Read", "Glob", "Grep", "Bash(git log *)", "Bash(git show *)", "Bash(git diff *)", "Bash(git status *)", "Bash(git ls-files *)"]));
  expect(tools).not.toContain("Bash");
  expect(tools).not.toContain("Edit");
  expect(tools).not.toContain("Write");
});

test("planner, reviewer, code review and demo nodes may read with cat, head, tail, wc, ls, grep and git branch, and never with a command that can write or run code", () => {
  for (const type of ["planner", "reviewer", "code_review", "demo"] as const) {
    const tools = nodeCatalog[type].allowedTools;
    expect(tools, type).toEqual(expect.arrayContaining(["Bash(cat *)", "Bash(head *)", "Bash(tail *)", "Bash(wc *)", "Bash(ls *)", "Bash(grep *)", "Bash(git branch --show-current)"]));
    // sed -i and find -exec write or run code, rg --pre runs a program, and git branch with a name creates one.
    const bash = tools.filter((t) => t.startsWith("Bash("));
    for (const program of ["sed", "find", "rg", "node", "awk", "xargs", "env", "sh", "bash"]) expect(bash.filter((t) => t.startsWith(`Bash(${program} `)), `${type} ${program}`).toEqual([]);
    expect(bash, type).not.toContain("Bash(git branch *)");
  }
});
