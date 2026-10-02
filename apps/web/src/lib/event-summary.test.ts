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

test("summarizes an overlap hold with the shared paths and the other run", () => {
  expect(
    summarizeEvent({
      type: "run.overlap_held",
      payload: { nodeKey: "coder", runId: "1a2b3c4d-0000-4000-8000-000000000000", paths: ["apps/board", "pnpm-lock.yaml"] },
    }),
  ).toBe("Waiting: shares apps/board, pnpm-lock.yaml with run 1a2b3c4d");
});

test("summarizes a run the scheduler started with its place in the order and the settings", () => {
  expect(
    summarizeEvent({ type: "run.scheduled", payload: { place: 1, settings: { maxRuns: 2, order: "project", graphName: "master", skipLabel: "human" } } }),
  ).toBe("Started by the scheduler, 1st in order: up to 2 runs, Project order, graph master");
});

test("summarizes the assignment of a run's issue to the token's user and one that was skipped, with the reason", () => {
  expect(summarizeEvent({ type: "issue.assigned", payload: { issue: 16, login: "Krister-Johansson" } })).toBe("#16 assigned to Krister-Johansson");
  expect(summarizeEvent({ type: "issue.assign.skipped", payload: { issue: 16, reason: "no-user" } })).toBe(
    "#16 not assigned: a GitHub App has no user to assign",
  );
  expect(summarizeEvent({ type: "issue.assign.skipped", payload: { issue: 16, reason: "not-assignable" } })).toBe(
    "#16 not assigned: GitHub cannot assign the token's user in this repository",
  );
  expect(summarizeEvent({ type: "issue.assign.skipped", payload: { issue: 16, reason: "Validation Failed" } })).toBe("#16 not assigned: Validation Failed");
});

test("an approval that held says why the step did not ask again", () => {
  const message = "Unchanged since your approval at 2026-10-02 14:03 UTC; only main was merged in";
  expect(summarizeEvent({ type: "approval.held", payload: { message, approvedAt: "2026-10-02T14:03:00.000Z", base: "main" } })).toBe(message);
});

test("returns an empty string for unknown events", () => {
  expect(summarizeEvent({ type: "something.new", payload: {} })).toBe("");
});
