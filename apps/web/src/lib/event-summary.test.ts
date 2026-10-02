import { expect, test } from "vitest";
import { summarizeEvent } from "./event-summary";

test("summarizes node lifecycle events with node and attempt", () => {
  expect(summarizeEvent({ type: "node.passed", payload: { nodeKey: "coder", attempt: 2 } })).toBe("coder, attempt 2");
});

test("summarizes an edge by its endpoints", () => {
  expect(summarizeEvent({ type: "edge.taken", payload: { from: "coder", to: "pr" } })).toBe("coder to pr");
});

test("summarizes assistant text from the CLI stream", () => {
  expect(
    summarizeEvent({ type: "cli.assistant", payload: { message: { content: [{ type: "text", text: "Reading the repo" }] } } }),
  ).toBe("Reading the repo");
});

test("summarizes a tool call by tool name", () => {
  expect(
    summarizeEvent({ type: "cli.assistant", payload: { message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "a.ts" } }] } } }),
  ).toBe("Edit a.ts");
});

test("summarizes a CLI result with turns and cost", () => {
  expect(summarizeEvent({ type: "cli.result.success", payload: { num_turns: 4, total_cost_usd: 0.1234 } })).toBe("4 turns, $0.12");
});

test("summarizes a failure with its error message", () => {
  expect(summarizeEvent({ type: "node.failed", payload: { nodeKey: "planner", attempt: 1, error: { code: "boom", message: "it broke" } } })).toBe(
    "planner, attempt 1: it broke",
  );
});

test("summarizes a status write on the plan and one that was skipped, with the reason", () => {
  expect(summarizeEvent({ type: "plan.status", payload: { issue: 57, status: "In review" } })).toBe("#57 to In review");
  expect(summarizeEvent({ type: "plan.skipped", payload: { issue: 90, status: "Running", reason: "not-in-project" } })).toBe(
    "#90 not moved to Running: not in the plan's Project",
  );
  expect(summarizeEvent({ type: "plan.skipped", payload: { issue: 57, status: "Done", reason: "Resource not accessible" } })).toBe(
    "#57 not moved to Done: Resource not accessible",
  );
});

test("returns an empty string for unknown events", () => {
  expect(summarizeEvent({ type: "something.new", payload: {} })).toBe("");
});
