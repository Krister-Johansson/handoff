import { expect, test } from "vitest";
import { allowedBy, describePermission, ruleFor } from "./permission.ts";

const MONITOR_INPUT = { command: "until grep -q done /tmp/e2e.log; do sleep 5; done", timeout_ms: 600000, description: "e2e run finishing (re-arm)" };

test("a Monitor call reads as its description and its command, not as JSON", () => {
  const input = { command: "until grep -q done /tmp/e2e.log; do sleep 5; done", timeout_ms: 600000, description: "e2e run finishing (re-arm)" };
  expect(describePermission("Monitor", input)).toEqual({
    action: "asks to use Monitor",
    description: "e2e run finishing (re-arm)",
    target: "until grep -q done /tmp/e2e.log; do sleep 5; done",
    detail: "e2e run finishing (re-arm)\nuntil grep -q done /tmp/e2e.log; do sleep 5; done",
    summary: "e2e run finishing (re-arm) · until grep -q done /tmp/e2e.log; do sleep 5; done",
  });
});

test("a Bash call without a description reads as its command", () => {
  expect(describePermission("Bash", { command: "git log --oneline -8" })).toEqual({
    action: "asks to run a command",
    target: "git log --oneline -8",
    detail: "git log --oneline -8",
    summary: "git log --oneline -8",
  });
  expect(describePermission("Bash", { command: "pnpm test", description: "Run the tests" }).summary).toBe("Run the tests · pnpm test");
});

test("a file tool reads as the file it touches", () => {
  expect(describePermission("Edit", { file_path: "/w/src/a.ts", old_string: "a", new_string: "b" })).toMatchObject({ action: "asks to change a file", detail: "/w/src/a.ts" });
  expect(describePermission("Write", { file_path: "/w/README.md", content: "# x\n".repeat(200) }).summary).toBe("/w/README.md");
  expect(describePermission("Read", { file_path: "/etc/hosts" })).toMatchObject({ action: "asks to read a file", detail: "/etc/hosts" });
  expect(describePermission("NotebookEdit", { notebook_path: "/w/a.ipynb", new_source: "x" }).detail).toBe("/w/a.ipynb");
});

test("an unknown tool reads as short key: value pairs, with long values cut", () => {
  const input = { query: "open issues", limit: 20, verbose: true, filter: { label: "bug" }, body: "x".repeat(300), none: null };
  const { action, detail, summary } = describePermission("mcp__github__search_issues", input);
  expect(action).toBe("asks to use mcp__github__search_issues");
  expect(detail).toBe(`query: open issues, limit: 20, verbose: true, filter: {"label":"bug"}, body: ${"x".repeat(59)}…`);
  expect(summary).toBe(detail);
  expect(describePermission("Skill", {}).detail).toBe("");
});

test("Always allow offers git show, not git, and nothing for cd or node", () => {
  const bash = (command: string) => ruleFor("Bash", { command });
  expect(bash("git show HEAD~1:src/a.ts")).toBe("Bash(git show *)");
  expect(bash("pnpm list --depth 0")).toBe("Bash(pnpm list *)");
  expect(bash("cat package.json")).toBe("Bash(cat *)");
  // An option before the subcommand would need a rule for every git command.
  expect(bash("git -C packages/core log")).toBeUndefined();
  for (const command of ["cd apps/web", "node -e 'console.log(1)'", "sh -c 'ls'", "bash scripts/x.sh", "env FOO=1 pnpm test"]) expect(bash(command)).toBeUndefined();
  // Claude Code matches each part of a compound command on its own; a cd in front needs no rule.
  expect(bash("cd apps/web && pnpm list react")).toBe("Bash(pnpm list *)");
  expect(bash("FORCE_COLOR=0 git diff main")).toBe("Bash(git diff *)");
  expect(ruleFor("WebFetch", { url: "https://example.com" })).toBe("WebFetch");
  expect(ruleFor("Monitor", MONITOR_INPUT)).toBe("Monitor");
});

test("a run's Always allow rules cover a later call the way Claude Code reads them, and nothing wider", () => {
  const bash = (command: string, rules: string[]) => allowedBy(rules, "Bash", { command });
  expect(allowedBy(["Monitor"], "Monitor", MONITOR_INPUT)).toBe("Monitor");
  expect(allowedBy(["Monitor"], "Bash", { command: "ls" })).toBeUndefined();
  expect(bash("git log --oneline -8", ["Bash(git log *)"])).toBe("Bash(git log *)");
  expect(bash("git log", ["Bash(git log *)"])).toBe("Bash(git log *)");
  expect(bash("FORCE_COLOR=0 git log main", ["Bash(git log *)"])).toBe("Bash(git log *)");
  expect(bash("cd apps/web && pnpm list react", ["Bash(pnpm list *)"])).toBe("Bash(pnpm list *)");
  // Claude Code matches each part of a compound command on its own.
  expect(bash("git log && rm -rf dist", ["Bash(git log *)"])).toBeUndefined();
  expect(bash("git log | grep fix", ["Bash(git log *)", "Bash(grep *)"])).toBe("Bash(git log *)");
  expect(bash("git logs", ["Bash(git log *)"])).toBeUndefined();
  expect(bash("git push", ["Bash(git log *)"])).toBeUndefined();
  expect(bash("cd apps/web", ["Bash(git log *)"])).toBeUndefined();
  // A command inside another, or one with nothing after its operator, is left to a person.
  expect(bash("git log $(rm -rf dist)", ["Bash(git log *)"])).toBeUndefined();
  expect(bash("git log `rm -rf dist`", ["Bash(git log *)"])).toBeUndefined();
  expect(bash("git log &&", ["Bash(git log *)"])).toBeUndefined();
  // A Monitor command follows the Bash rules too.
  expect(allowedBy(["Bash(pnpm test *)"], "Monitor", { command: "pnpm test --watch", description: "tests" })).toBe("Bash(pnpm test *)");
  expect(allowedBy(["WebFetch"], "WebFetch", { url: "https://example.com" })).toBe("WebFetch");
});

test("Always allow rules leave out a file descriptor redirect such as 2>&1, as Claude Code does", () => {
  const bash = (command: string, rules: string[]) => allowedBy(rules, "Bash", { command });
  expect(bash("pnpm exec biome check 2>&1 | tail -30", ["Bash(pnpm *)", "Bash(tail *)"])).toBe("Bash(pnpm *)");
  expect(bash("ls docs 1>&2", ["Bash(ls *)"])).toBe("Bash(ls *)");
  expect(bash("cat <&3", ["Bash(cat)"])).toBe("Bash(cat)");
  expect(bash("pnpm test 2>&1", ["Bash(pnpm test)"])).toBe("Bash(pnpm test)");
});

test("Always allow rules split a command only on separators outside quotes and escapes", () => {
  const bash = (command: string, rules: string[]) => allowedBy(rules, "Bash", { command });
  expect(bash('grep -n "biome\\|turbo" docs/x.md | head -20', ["Bash(grep *)", "Bash(head *)"])).toBe("Bash(grep *)");
  // The quoted | is not a split: a rule for grep with that exact pattern covers the whole grep.
  expect(bash('grep -n "biome\\|turbo" docs/x.md', ['Bash(grep -n "biome\\|turbo" docs/x.md)'])).toBe('Bash(grep -n "biome\\|turbo" docs/x.md)');
  // One command: a rule for rm is never asked for it, and a rule for echo covers it.
  expect(bash('echo "a; rm -rf /"', ["Bash(echo *)"])).toBe("Bash(echo *)");
  expect(bash("echo 'a && rm -rf /'", ["Bash(echo *)"])).toBe("Bash(echo *)");
  expect(bash("echo a\\;rm", ["Bash(echo *)"])).toBe("Bash(echo *)");
  expect(bash('echo "a" ; rm -rf /', ["Bash(echo *)"])).toBeUndefined();
});

test("Always allow rules cover a redirect to /dev/null but never one to a file", () => {
  const bash = (command: string, rules: string[]) => allowedBy(rules, "Bash", { command });
  expect(bash("cmd > out.txt", ["Bash(cmd *)"])).toBeUndefined();
  expect(bash("cmd >> out.txt", ["Bash(cmd *)"])).toBeUndefined();
  expect(bash("cmd 2> err.txt", ["Bash(cmd *)"])).toBeUndefined();
  expect(bash("cmd >out.txt 2>&1", ["Bash(cmd *)"])).toBeUndefined();
  expect(bash("cmd < in.txt", ["Bash(cmd *)"])).toBeUndefined();
  expect(bash("cmd > /dev/null 2>&1", ["Bash(cmd *)"])).toBe("Bash(cmd *)");
  expect(bash("cmd >/dev/null 2>&1; echo done", ["Bash(cmd *)", "Bash(echo *)"])).toBe("Bash(cmd *)");
  expect(bash("cmd &> /dev/null", ["Bash(cmd)"])).toBe("Bash(cmd)");
  // A quoted > is text, not a redirect.
  expect(bash('echo "a > b"', ["Bash(echo *)"])).toBe("Bash(echo *)");
});

test("a command that cannot be read matches no Always allow rule", () => {
  const bash = (command: string) => allowedBy(["Bash(echo *)", "Bash(git log *)", "Bash(cat *)"], "Bash", { command });
  for (const command of ['echo "a', "echo 'a", "echo a\\", "git log ||", "git log && && echo a", "| git log", "cat <<EOF\nx\nEOF", "cat <(git log)"]) {
    expect(bash(command), command).toBeUndefined();
  }
});
