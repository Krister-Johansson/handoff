import { expect, test } from "vitest";
import planReview from "../fixtures/plan-review.graph.json" with { type: "json" };
import type { GraphDocumentInput } from "../schema/graph.ts";
import { compileGraph, type CompiledGraph } from "./compile.ts";
import { stepProgress } from "./progress.ts";

function compiled(document: unknown): CompiledGraph {
  const result = compileGraph(document);
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("; "));
  return result.graph;
}

/** start, plan, code, review and pr in a line, with review sending work back to code. */
const reviewLoop: GraphDocumentInput = {
  attributes: { startNode: "planner" },
  nodes: [
    { key: "planner", attributes: { type: "planner" } },
    { key: "coder", attributes: { type: "coder" } },
    { key: "reviewer", attributes: { type: "reviewer" } },
    { key: "pr", attributes: { type: "pr" } },
  ],
  edges: [
    { key: "planner->coder", source: "planner", target: "coder" },
    { key: "coder->reviewer", source: "coder", target: "reviewer" },
    { key: "reviewer->coder", source: "reviewer", target: "coder", attributes: { loop: true, maxAttempts: 3 } },
    { key: "reviewer->pr", source: "reviewer", target: "pr" },
  ],
};

const at = (minute: number) => new Date(Date.UTC(2026, 9, 3, 12, minute));

test("the total counts nodes reachable over non-loop edges without Start, Finish and exhausted gates", () => {
  // plan-review: Start and Finish do not count; the question gate is a branch a condition may skip, and counts.
  expect(stepProgress(compiled(planReview), [])).toEqual({ done: 0, total: 8 });

  // A gate the run reaches only when a loop runs out of rounds is not a step of the run.
  const exhausted = structuredClone(reviewLoop);
  exhausted.attributes.exhaustedGate = "stuck";
  exhausted.nodes.push({ key: "stuck", attributes: { type: "human_gate" } });
  exhausted.edges.push(
    { key: "reviewer->stuck", source: "reviewer", target: "stuck", attributes: { loop: true, maxAttempts: 1 } },
    { key: "stuck->coder", source: "stuck", target: "coder", attributes: { loop: true, maxAttempts: 1 } },
  );
  expect(stepProgress(compiled(exhausted), [])).toEqual({ done: 0, total: 4 });
});

test("a node is done when its latest execution passed after every node before it", () => {
  const graph = compiled(reviewLoop);

  expect(
    stepProgress(graph, [
      { nodeKey: "planner", status: "passed", createdAt: at(0) },
      { nodeKey: "coder", status: "passed", createdAt: at(5) },
      { nodeKey: "reviewer", status: "running", createdAt: at(30) },
    ]),
  ).toEqual({ done: 2, total: 4 });

  // A coder that passed but started before the planner's latest visit has not done the planner's work.
  expect(
    stepProgress(graph, [
      { nodeKey: "planner", status: "passed", createdAt: at(0) },
      { nodeKey: "coder", status: "passed", createdAt: at(5) },
      { nodeKey: "planner", status: "passed", createdAt: at(20) },
    ]),
  ).toEqual({ done: 1, total: 4 });
});

test("a loop back to the coder takes the coder and the nodes after it out of done", () => {
  const graph = compiled(reviewLoop);
  const reviewed = [
    { nodeKey: "planner", status: "passed", createdAt: at(0) },
    { nodeKey: "coder", status: "passed", createdAt: at(5) },
    { nodeKey: "reviewer", status: "passed", createdAt: at(30) },
  ];
  expect(stepProgress(graph, reviewed)).toEqual({ done: 3, total: 4 });

  // The review asked for changes: a second coder visit starts and the review's pass no longer counts.
  const sentBack = [...reviewed, { nodeKey: "coder", status: "running", createdAt: at(40) }];
  expect(stepProgress(graph, sentBack)).toEqual({ done: 1, total: 4 });

  // The coder passes again; the review waits for its next visit.
  const recoded = [...reviewed, { nodeKey: "coder", status: "passed", createdAt: at(40) }];
  expect(stepProgress(graph, recoded)).toEqual({ done: 2, total: 4 });
});
