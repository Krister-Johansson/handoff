import { expect, test } from "vitest";
import linear from "../fixtures/linear.graph.json" with { type: "json" };
import { compileGraph, type CompiledGraph } from "./compile.ts";
import { matchingEdges } from "./routing.ts";

function compiled(mutate?: (doc: typeof linear) => void): CompiledGraph {
  const doc = structuredClone(linear);
  mutate?.(doc);
  const result = compileGraph(doc);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.graph;
}

const nodeCtx = (output: unknown) => ({ key: "coder", status: "passed", attempt: 1, output });

test("matchingEdges follows an edge whose condition matches the node output", () => {
  const edges = matchingEdges(compiled(), "coder", "passed", { state: {}, node: nodeCtx({ status: "done" }) });
  expect(edges.map((e) => e.key)).toEqual(["coder->pr"]);
});

test("matchingEdges follows nothing when the condition does not match", () => {
  expect(matchingEdges(compiled(), "coder", "passed", { state: {}, node: nodeCtx({ status: "needs_input" }) })).toEqual([]);
});

test("matchingEdges ignores passed edges when the node failed", () => {
  expect(matchingEdges(compiled(), "planner", "failed", { state: {}, node: nodeCtx({}) })).toEqual([]);
});

test("matchingEdges takes an edge declared for failure when the node failed", () => {
  const graph = compiled((doc) => {
    doc.nodes.push({ key: "gate", attributes: { type: "human_gate", label: "Gate", x: 0, y: 0 } });
    doc.edges.push({ key: "planner-fail", source: "planner", target: "gate", attributes: { loop: false, on: "failed" } as never });
  });
  expect(matchingEdges(graph, "planner", "failed", { state: {}, node: nodeCtx({}) }).map((e) => e.key)).toEqual(["planner-fail"]);
});

test("matchingEdges takes every matching edge for fan-out", () => {
  const graph = compiled((doc) => {
    doc.nodes.push({ key: "notes", attributes: { type: "function", label: "Notes", x: 0, y: 0 } });
    doc.edges.push({ key: "planner->notes", source: "planner", target: "notes", attributes: { loop: false } });
  });
  expect(matchingEdges(graph, "planner", "passed", { state: {}, node: nodeCtx({}) }).map((e) => e.key).sort()).toEqual([
    "planner->coder",
    "planner->notes",
  ]);
});
