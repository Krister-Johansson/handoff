import { CameraIcon, ClipboardListIcon, CodeIcon, FileSearchIcon, FlagIcon, PlayIcon, EyeIcon, FlaskConicalIcon, GitMergeIcon, GitPullRequestIcon, SquareFunctionIcon, UserRoundIcon, type LucideIcon } from "lucide-react";
import type { NodeType } from "@handoff/core";

export const NODE_ICONS: Record<NodeType, LucideIcon> = {
  start: PlayIcon,
  finish: FlagIcon,
  planner: ClipboardListIcon,
  coder: CodeIcon,
  reviewer: EyeIcon,
  code_review: FileSearchIcon,
  tester: FlaskConicalIcon,
  demo: CameraIcon,
  pr: GitPullRequestIcon,
  merge: GitMergeIcon,
  human_gate: UserRoundIcon,
  function: SquareFunctionIcon,
};
