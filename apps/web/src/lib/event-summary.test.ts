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

test("returns an empty string for unknown events", () => {
  expect(summarizeEvent({ type: "something.new", payload: {} })).toBe("");
});
