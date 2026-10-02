import { expect, test } from "vitest";
import { initialRunState, type CompiledNode, type NodeType, type RunState } from "@handoff/core";
import type { NodeExecutionRow } from "@handoff/db";
import { selectContext } from "./context.ts";

const node = (key: string, type: NodeType): CompiledNode => ({
  key,
  type,
  label: key,
  config: {},
  contract: { output: type === "coder" ? "coder_output" : "reviewer_output", checks: [] },
  contextSelector: { stateKeys: [], repoPaths: [], includeFeedback: false, includePriorAttempt: true },
  library: { skills: [], mcp: [], agents: [], groups: [] },
  x: 0,
  y: 0,
});
const execution = { attempt: 1, trigger: null, repairNote: null } as unknown as NodeExecutionRow;
const plan = { plan: "Add a board.", steps: ["Add the route"], ownedPaths: ["src/board.ts"] };
const withNodes = (nodes: RunState["nodes"]): RunState => ({ ...initialRunState("Add a board"), plan, nodes });
const result = (output: unknown) => ({ output, executionId: "e1", attempt: 1 });

test("a review's stage is plan until a coder has passed, then code", () => {
  const review = node("review", "reviewer");
  expect(selectContext(review, withNodes({ planner: result(plan) }), execution).stage).toBe("plan");
  expect(selectContext(review, withNodes({ planner: result(plan), coder: result({ status: "needs_input", summary: "", question: { text: "Which?" } }) }), execution).stage).toBe("plan");
  expect(selectContext(review, withNodes({ planner: result(plan), coder: result({ status: "done", summary: "Added the board." }) }), execution).stage).toBe("code");
  expect(selectContext(node("coder", "coder"), withNodes({}), execution).stage).toBeUndefined();
});

test("a review that approved with findings gets them back with its verdict when it runs again", () => {
  const approved = { verdict: "approve", comments: [{ path: "src/board.ts", line: 4, body: "Name the constant.", severity: "should_fix" }] };
  const state = { ...withNodes({ review: result(approved), coder: result({ status: "done", summary: "Named it." }) }), reviewedAt: { review: "4ef4f22" } };
  expect(selectContext(node("review", "code_review"), state, execution, ["coder"]).previousReview).toEqual({
    verdict: "approve",
    comments: [{ path: "src/board.ts", line: 4, body: "Name the constant.", severity: "should_fix" }],
    reply: "Named it.",
    reviewedAt: "4ef4f22",
  });
  const clean = withNodes({ review: result({ verdict: "approve", comments: [] }) });
  expect(selectContext(node("review", "code_review"), clean, execution).previousReview).toBeUndefined();
});
