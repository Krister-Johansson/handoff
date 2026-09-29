import { describe, expect, test } from "vitest";
import linear from "@handoff/core/fixtures/linear.graph.json";
import { toReactFlow } from "@handoff/core";
import { documentOf, editorReducer, issuesOf } from "./state";

const initial = () => toReactFlow(linear);

describe("graph editor state", () => {
  test("adding a Coder node from the palette makes it appear in the saved document", () => {
    const state = editorReducer(initial(), { type: "addNode", nodeType: "coder", position: { x: 10, y: 20 } });
    const doc = documentOf(state);
    const added = doc.nodes.find((n) => n.key === "coder-2")!;
    expect(added.attributes).toMatchObject({ type: "coder", label: "Coder", x: 10, y: 20 });
  });

  test("connecting two nodes creates an edge with no condition", () => {
    let state = editorReducer(initial(), { type: "addNode", nodeType: "reviewer", position: { x: 0, y: 0 } });
    state = editorReducer(state, { type: "connect", source: "coder", target: "reviewer-1" });
    const edge = documentOf(state).edges.find((e) => e.key === "coder->reviewer-1")!;
    expect(edge.attributes).toEqual({ on: "passed", loop: false, priority: 0 });
  });

  test("connecting the same pair twice gets a unique edge key", () => {
    let state = editorReducer(initial(), { type: "connect", source: "coder", target: "pr" });
    state = editorReducer(state, { type: "connect", source: "coder", target: "pr" });
    expect(state.edges.filter((e) => e.source === "coder" && e.target === "pr").map((e) => e.id)).toEqual(["coder->pr", "coder->pr-2", "coder->pr-3"]);
  });

  test("updating an edge to a loop with attempts is reflected in the document and validation", () => {
    let state = editorReducer(initial(), { type: "connect", source: "pr", target: "coder" });
    expect(issuesOf(state).map((i) => i.code)).toContain("non_loop_cycle");
    state = editorReducer(state, { type: "updateEdge", id: "pr->coder", patch: { loop: true, maxAttempts: 2 } });
    expect(issuesOf(state)).toEqual([]);
  });

  test("a dragged position updates only the node's position", () => {
    const state = editorReducer(initial(), { type: "nodesChange", changes: [{ type: "position", id: "pr", position: { x: 5, y: 6 } }] });
    expect(state.nodes.find((n) => n.id === "pr")!.position).toEqual({ x: 5, y: 6 });
    expect(state.nodes.find((n) => n.id === "pr")!.data).toEqual(initial().nodes.find((n) => n.id === "pr")!.data);
  });

  test("removing a node removes its edges", () => {
    const state = editorReducer(initial(), { type: "nodesChange", changes: [{ type: "remove", id: "coder" }] });
    expect(state.edges.some((e) => e.source === "coder" || e.target === "coder")).toBe(false);
  });

  test("setting the start node moves the start flag", () => {
    const state = editorReducer(initial(), { type: "setStart", id: "coder" });
    expect(documentOf(state).attributes.startNode).toBe("coder");
    expect(state.nodes.filter((n) => n.data.isStart).map((n) => n.id)).toEqual(["coder"]);
  });

  test("updating node data merges config", () => {
    const state = editorReducer(initial(), { type: "updateNode", id: "coder", patch: { label: "Implement", config: { maxTurns: 30 } } });
    expect(documentOf(state).nodes.find((n) => n.key === "coder")!.attributes).toMatchObject({ label: "Implement", config: { maxTurns: 30 } });
  });
});

test("tidy layout changes positions only", () => {
  const before = initial();
  const after = editorReducer(before, { type: "layout" });
  expect(after.nodes.map((n) => n.data)).toEqual(before.nodes.map((n) => n.data));
  expect(after.edges).toEqual(before.edges);
});
