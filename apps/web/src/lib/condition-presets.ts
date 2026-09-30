import type { Condition } from "@handoff/core";

/** Common edge conditions for the default node types, offered in the edge inspector. */
export const CONDITION_PRESETS: { label: string; condition: Condition }[] = [
  { label: "Coder finished", condition: { eq: ["node.output.status", "done"] } },
  { label: "Coder asked a question", condition: { eq: ["node.output.status", "needs_input"] } },
  { label: "Tests passed", condition: { eq: ["node.output.passed", true] } },
  { label: "Tests failed", condition: { eq: ["node.output.passed", false] } },
  { label: "Review approved", condition: { eq: ["node.output.verdict", "approve"] } },
  { label: "Review requested changes", condition: { eq: ["node.output.verdict", "request_changes"] } },
  {
    label: "CI green and not blocked",
    condition: { all: [{ eq: ["node.output.feedback.ci.status", "success"] }, { neq: ["node.output.feedback.review.decision", "changes_requested"] }] },
  },
  {
    label: "CI failed or changes requested",
    condition: { any: [{ eq: ["node.output.feedback.ci.status", "failure"] }, { eq: ["node.output.feedback.review.decision", "changes_requested"] }] },
  },
  { label: "Person approved", condition: { eq: ["node.output.option", "approve"] } },
  { label: "Person did not abort", condition: { neq: ["node.output.option", "abort"] } },
];
