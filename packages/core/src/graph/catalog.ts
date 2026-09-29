import type { ContractName } from "../schema/contracts.ts";
import type { ExecutorKind, NodeType } from "../schema/graph.ts";

export type CatalogEntry = {
  executorKind: ExecutorKind;
  contract: ContractName;
  /** Default --allowedTools for cli nodes. */
  allowedTools: string[];
};

const readOnlyTools = ["Read", "Glob", "Grep"];
const coderTools = [...readOnlyTools, "Edit", "Write", "Bash(git *)", "Bash(pnpm *)", "Bash(npm *)", "Bash(npx *)"];

export const nodeCatalog: Record<NodeType, CatalogEntry> = {
  planner: { executorKind: "cli", contract: "planner_output", allowedTools: readOnlyTools },
  coder: { executorKind: "cli", contract: "coder_output", allowedTools: coderTools },
  reviewer: { executorKind: "cli", contract: "reviewer_output", allowedTools: [...readOnlyTools, "Bash(git diff *)", "Bash(git log *)", "Bash(git show *)"] },
  tester: { executorKind: "shell", contract: "tester_output", allowedTools: [] },
  pr: { executorKind: "github", contract: "pr_output", allowedTools: [] },
  merge: { executorKind: "github", contract: "merge_output", allowedTools: [] },
  human_gate: { executorKind: "human", contract: "human_answer", allowedTools: [] },
  function: { executorKind: "function", contract: "function_output", allowedTools: [] },
};

export function isNodeType(type: string): type is NodeType {
  return Object.hasOwn(nodeCatalog, type);
}
