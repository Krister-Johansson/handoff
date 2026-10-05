import { expect, test } from "vitest";
import { allowedBy } from "../permission.ts";
import { nodeCatalog } from "./catalog.ts";

const CLI_NODES = ["planner", "coder", "reviewer", "code_review", "demo"] as const;

/** Whether a node's default --allowedTools cover a command, each part of a compound command on its own. */
const covers = (type: (typeof CLI_NODES)[number], command: string) => allowedBy(nodeCatalog[type].allowedTools, "Bash", { command }) !== undefined;

test("the planner may look at the repository's git history, but not change anything or run other commands", () => {
  const tools = nodeCatalog.planner.allowedTools;
  expect(tools).toEqual(expect.arrayContaining(["Read", "Glob", "Grep", "Bash(git log *)", "Bash(git show *)", "Bash(git diff *)", "Bash(git status *)", "Bash(git ls-files *)"]));
  expect(tools).not.toContain("Bash");
  expect(tools).not.toContain("Edit");
  expect(tools).not.toContain("Write");
});

test("the coder keeps its own tools", () => {
  expect(nodeCatalog.coder.allowedTools).toEqual(expect.arrayContaining(["Read", "Glob", "Grep", "Edit", "Write", "Bash(git *)", "Bash(pnpm *)", "Bash(npm *)", "Bash(npx *)"]));
});

test("every CLI node may read with cat, head, tail, wc, ls, grep and git branch, and never with a command that can write or run code", () => {
  for (const type of CLI_NODES) {
    const tools = nodeCatalog[type].allowedTools;
    expect(tools, type).toEqual(expect.arrayContaining(["Bash(cat *)", "Bash(head *)", "Bash(tail *)", "Bash(wc *)", "Bash(ls *)", "Bash(grep *)", "Bash(git branch --show-current)"]));
    // sed -i and find -exec write or run code, rg --pre and awk's system() run a program, and git branch with a name creates one.
    const bash = tools.filter((t) => t.startsWith("Bash("));
    for (const program of ["sed", "find", "rg", "awk", "xargs", "env", "sh", "bash"]) expect(bash.filter((t) => t.startsWith(`Bash(${program} `)), `${type} ${program}`).toEqual([]);
    expect(bash, type).not.toContain("Bash(git branch *)");
  }
});

test("every CLI node may sort, count and cut lines and print the node and pnpm versions without asking", () => {
  for (const type of CLI_NODES) {
    for (const command of ["sort", "sort -n", "sort -r", "sort -rn", "sort -u", "uniq", "uniq -c", "cut -d/ -f1,2", "node -v", "node --version", "pnpm -v", "pnpm --version"]) {
      expect(covers(type, command), `${type}: ${command}`).toBe(true);
    }
  }
});

test("no CLI node may write a file with sort or uniq, or run a script with node, without asking", () => {
  for (const type of CLI_NODES) {
    // sort -o and uniq's second file name write a file, and node runs whatever it is given.
    for (const command of ["sort -o out.txt", "sort -n -o out.txt in.txt", "uniq in.txt out.txt", "uniq -c in.txt out.txt", "node -e 'require(\"fs\").rmSync(\"x\")'", "node scripts/x.js"]) {
      expect(covers(type, command), `${type}: ${command}`).toBe(false);
    }
    const bash = nodeCatalog[type].allowedTools.filter((t) => t.startsWith("Bash("));
    expect(bash, type).not.toContain("Bash(sort *)");
    expect(bash, type).not.toContain("Bash(uniq *)");
    expect(bash, type).not.toContain("Bash(node *)");
  }
});

test("the read-only commands that waited on a person in run 33311b09 are covered, apart from awk", () => {
  // The coder: git ls-files ... | awk -F/ '{print $1"/"$2}' | sort | uniq -c. awk stays a question for a person.
  for (const command of ["git ls-files apps packages", "sort", "uniq -c"]) expect(covers("coder", command), command).toBe(true);
  expect(covers("coder", `awk -F/ '{print $1"/"$2}'`)).toBe(false);
  // The code review: head -40 pnpm-lock.yaml; node -v; pnpm -v; ls docs/sources 2>&1 | head -3; ls -a | head -30.
  // Claude Code skips a file descriptor redirect such as 2>&1 when it matches --allowedTools, so the ls part is ls docs/sources.
  for (const command of ["head -40 pnpm-lock.yaml", "node -v", "pnpm -v", "ls docs/sources", "head -3", "ls -a", "head -30"]) expect(covers("code_review", command), command).toBe(true);
  expect(covers("code_review", "head -40 pnpm-lock.yaml; node -v; pnpm -v; ls -a | head -30")).toBe(true);
});
