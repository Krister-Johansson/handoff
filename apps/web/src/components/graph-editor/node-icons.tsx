import { ClipboardListIcon, CodeIcon, EyeIcon, FlaskConicalIcon, GitMergeIcon, GitPullRequestIcon, SquareFunctionIcon, UserRoundIcon, type LucideIcon } from "lucide-react";
import type { NodeType } from "@handoff/core";

export const NODE_ICONS: Record<NodeType, LucideIcon> = {
  planner: ClipboardListIcon,
  coder: CodeIcon,
  reviewer: EyeIcon,
  tester: FlaskConicalIcon,
  pr: GitPullRequestIcon,
  merge: GitMergeIcon,
  human_gate: UserRoundIcon,
  function: SquareFunctionIcon,
};
