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
  planner: { executorKind: "cli", contract: "planner_output", allowedTools: [...readOnlyTools, ...readGitTools] },
  coder: { executorKind: "cli", contract: "coder_output", allowedTools: coderTools },
  reviewer: { executorKind: "cli", contract: "reviewer_output", allowedTools: [...readOnlyTools, ...readGitTools] },
  // Claude Code's code-review skill, run through the Skill tool, reading the branch's diff with git.
  code_review: {
    executorKind: "cli",
    contract: "reviewer_output",
    allowedTools: [...readOnlyTools, "Skill", "Bash(git diff *)", "Bash(git log *)", "Bash(git show *)", "Bash(git merge-base *)", "Bash(git rev-parse *)"],
  },
  tester: { executorKind: "shell", contract: "tester_output", allowedTools: [] },
  pr: { executorKind: "github", contract: "pr_output", allowedTools: [] },
  merge: { executorKind: "github", contract: "merge_output", allowedTools: [] },
  human_gate: { executorKind: "human", contract: "human_answer", allowedTools: [] },
  function: { executorKind: "function", contract: "function_output", allowedTools: [] },
};

export function isNodeType(type: string): type is NodeType {
  return Object.hasOwn(nodeCatalog, type);
}
