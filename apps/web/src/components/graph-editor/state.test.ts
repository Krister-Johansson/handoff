import { describe, expect, test } from "vitest";
import linear from "@handoff/core/fixtures/linear.graph.json";
import { toReactFlow } from "@handoff/core";
import { changesEdit, documentOf, editorReducer, issuesOf } from "./state";

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

  test("connecting reviewer changes to planner feedback records the port and the input", () => {
    let state = editorReducer(initial(), { type: "addNode", nodeType: "reviewer", position: { x: 0, y: 0 } });
    state = editorReducer(state, { type: "connect", source: "reviewer-1", target: "planner", sourceHandle: "changes", targetHandle: "feedback" });
    expect(state.edges.find((e) => e.id === "reviewer-1->planner")).toMatchObject({ sourceHandle: "changes", targetHandle: "feedback" });
    expect(documentOf(state).edges.find((e) => e.key === "reviewer-1->planner")!.attributes).toMatchObject({ port: "changes", input: "feedback" });
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

test("applying a layout moves nodes to its positions and changes nothing else", () => {
  const before = initial();
  const after = editorReducer(before, { type: "applyLayout", positions: { planner: { x: 12.4, y: 40 }, coder: { x: 300, y: 40 } } });
  expect(after.nodes.find((n) => n.id === "planner")!.position).toEqual({ x: 12.4, y: 40 });
  expect(after.nodes.find((n) => n.id === "pr")!.position).toEqual(before.nodes.find((n) => n.id === "pr")!.position);
  expect(after.nodes.map((n) => n.data)).toEqual(before.nodes.map((n) => n.data));
  expect(after.edges).toEqual(before.edges);
});

describe("delete and rename", () => {
  test("removing a selected edge deletes only that edge", () => {
    const state = editorReducer(initial(), { type: "remove", ids: ["coder->pr"] });
    expect(state.edges.map((e) => e.id)).toEqual(["planner->coder", "pr->merge"]);
    expect(state.nodes).toHaveLength(4);
  });

  test("removing a node also removes its edges", () => {
    const state = editorReducer(initial(), { type: "remove", ids: ["pr"] });
    expect(state.nodes.map((n) => n.id)).toEqual(["planner", "coder", "merge"]);
    expect(state.edges.map((e) => e.id)).toEqual(["planner->coder"]);
  });

  test("renaming a node key updates its edges, the start node and exhaustion targets", () => {
    let state = editorReducer(initial(), { type: "addNode", nodeType: "human_gate", position: { x: 0, y: 0 } });
    state = editorReducer(state, { type: "setExhaustedGate", id: "human_gate-1" });
    state = editorReducer(state, { type: "connect", source: "pr", target: "coder" });
    state = editorReducer(state, { type: "updateEdge", id: "pr->coder", patch: { loop: true, maxAttempts: 2, onExhausted: "human_gate-1" } });
    state = editorReducer(state, { type: "renameNode", id: "human_gate-1", to: "ask" });
    state = editorReducer(state, { type: "renameNode", id: "planner", to: "plan" });
    const doc = documentOf(state);
    expect(doc.attributes).toMatchObject({ startNode: "plan", exhaustedGate: "ask" });
    expect(doc.edges.find((e) => e.key === "plan->coder")).toMatchObject({ source: "plan", target: "coder" });
    expect(doc.edges.find((e) => e.key === "pr->coder")!.attributes.onExhausted).toBe("ask");
  });

  test("renaming to an existing or invalid key is ignored", () => {
    const before = initial();
    expect(editorReducer(before, { type: "renameNode", id: "coder", to: "pr" })).toBe(before);
    expect(editorReducer(before, { type: "renameNode", id: "coder", to: "has space" })).toBe(before);
  });
});

test("measuring and selecting do not count as edits; moving, adding and removing do", () => {
  expect(changesEdit({ type: "nodesChange", changes: [{ type: "dimensions", id: "pr", dimensions: { width: 1, height: 1 } }] })).toBe(false);
  expect(changesEdit({ type: "nodesChange", changes: [{ type: "select", id: "pr", selected: true }] })).toBe(false);
  expect(changesEdit({ type: "edgesChange", changes: [{ type: "select", id: "coder->pr", selected: true }] })).toBe(false);
  expect(changesEdit({ type: "nodesChange", changes: [{ type: "position", id: "pr", position: { x: 1, y: 1 } }] })).toBe(true);
  expect(changesEdit({ type: "nodesChange", changes: [{ type: "remove", id: "pr" }] })).toBe(true);
  expect(changesEdit({ type: "connect", source: "a", target: "b" })).toBe(true);
});
