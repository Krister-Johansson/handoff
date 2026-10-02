import type { ContractName } from "../schema/contracts.ts";
import type { ExecutorKind, NodeType } from "../schema/graph.ts";

export type CatalogEntry = {
  executorKind: ExecutorKind;
  contract: ContractName;
  /** Default --allowedTools for cli nodes. */
  allowedTools: string[];
};

const readOnlyTools = ["Read", "Glob", "Grep"];
/** Git commands that only read: enough to see the history and state of the branch. */
const readGitTools = ["Bash(git log *)", "Bash(git show *)", "Bash(git diff *)", "Bash(git status *)", "Bash(git ls-files *)"];
/**
 * Shell commands that read and cannot write a file or run another program. Claude Code matches each part
 * of a compound command (`&&`, `||`, `;`, `|`) against the rules on its own and checks a redirect's
 * target against the file rules, so `cat a | grep b` is allowed and `cat a > b` still needs Edit.
 * sed (-i), find (-exec), awk (system) and rg (--pre) stay out, and git branch only in forms that cannot
 * create or delete one.
 */
const readShellTools = ["Bash(cat *)", "Bash(head *)", "Bash(tail *)", "Bash(wc *)", "Bash(ls *)", "Bash(grep *)", "Bash(git branch)", "Bash(git branch --show-current)", "Bash(git branch -a)"];

/**
 * Every Claude Code tool a headless step can use, for a node that allows every tool: still passed
 * as an explicit --allowedTools list. Tools that publish outside the run (Artifact) or manage the
 * session (worktrees, plan mode, cron) stay out, and so do the task tools, which listing would
 * turn on for models that leave them off.
 */
export const ALL_TOOLS = ["Read", "Glob", "Grep", "Edit", "Write", "NotebookEdit", "Bash", "WebFetch", "WebSearch", "Agent", "Skill"];
const coderTools = [...readOnlyTools, "Edit", "Write", "Bash(git *)", "Bash(pnpm *)", "Bash(npm *)", "Bash(npx *)"];

export const nodeCatalog: Record<NodeType, CatalogEntry> = {
  start: { executorKind: "function", contract: "start_output", allowedTools: [] },
  finish: { executorKind: "function", contract: "finish_output", allowedTools: [] },
  planner: { executorKind: "cli", contract: "planner_output", allowedTools: [...readOnlyTools, ...readGitTools, ...readShellTools] },
  coder: { executorKind: "cli", contract: "coder_output", allowedTools: coderTools },
  reviewer: { executorKind: "cli", contract: "reviewer_output", allowedTools: [...readOnlyTools, ...readGitTools, ...readShellTools] },
  // Claude Code's code-review skill, run through the Skill tool, reading the branch's diff with git.
  code_review: {
    executorKind: "cli",
    contract: "reviewer_output",
    allowedTools: [...readOnlyTools, "Skill", "Bash(git diff *)", "Bash(git log *)", "Bash(git show *)", "Bash(git merge-base *)", "Bash(git rev-parse *)", ...readShellTools],
  },
  tester: { executorKind: "shell", contract: "tester_output", allowedTools: [] },
  // Walks through the running app in a headless browser (the Playwright MCP server) and takes screenshots.
  demo: { executorKind: "cli", contract: "demo_output", allowedTools: [...readOnlyTools, ...readShellTools, "mcp__playwright"] },
  pr: { executorKind: "github", contract: "pr_output", allowedTools: [] },
  merge: { executorKind: "github", contract: "merge_output", allowedTools: [] },
  human_gate: { executorKind: "human", contract: "human_answer", allowedTools: [] },
  function: { executorKind: "function", contract: "function_output", allowedTools: [] },
};

export function isNodeType(type: string): type is NodeType {
  return Object.hasOwn(nodeCatalog, type);
}
