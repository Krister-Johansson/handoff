import { describe, expect, test } from "vitest";
import linear from "../fixtures/linear.graph.json" with { type: "json" };
import { compileGraph, type CompileResult } from "./compile.ts";

type Doc = typeof linear;
const clone = (): Doc => structuredClone(linear);
const codes = (result: CompileResult) => (result.ok ? [] : result.errors.map((e) => e.code));

describe("compileGraph", () => {
  test("compileGraph accepts the linear fixture and exposes nodes in topological order", () => {
    const result = compileGraph(linear);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.startNode).toBe("planner");
    expect(result.graph.order).toEqual(["planner", "coder", "pr", "merge"]);
    expect(result.graph.node("coder").type).toBe("coder");
    expect(result.graph.outEdges("coder").map((e) => e.target)).toEqual(["pr"]);
  });

  test("compileGraph fills catalog defaults for contract and executor kind", () => {
    const result = compileGraph(linear);
    if (!result.ok) throw new Error("expected ok");
    expect(result.graph.node("coder").contract.output).toBe("coder_output");
    expect(result.graph.executorKind("coder")).toBe("cli");
    expect(result.graph.executorKind("pr")).toBe("github");
  });

  test("compileGraph rejects a document that is not a graph", () => {
    const found = codes(compileGraph({ nodes: "nope" }));
    expect(found.length).toBeGreaterThan(0);
    expect(new Set(found)).toEqual(new Set(["invalid_document"]));
  });

  test("compileGraph rejects a node whose type is not in the catalog", () => {
    const doc = clone();
    doc.nodes[1]!.attributes.type = "wizard";
    const result = compileGraph(doc);
    expect(codes(result)).toContain("unknown_node_type");
    expect(result.ok ? undefined : result.errors[0]?.nodeKey).toBe("coder");
  });

  test("compileGraph rejects an edge whose source or target does not exist", () => {
    const doc = clone();
    doc.edges[2]!.target = "ghost";
    expect(codes(compileGraph(doc))).toContain("unknown_edge_endpoint");
  });

  test("compileGraph rejects a graph with no start node", () => {
    const doc = clone();
    doc.attributes.startNode = "ghost";
    expect(codes(compileGraph(doc))).toContain("missing_start_node");
  });

  test("compileGraph rejects a node unreachable from the start node", () => {
    const doc = clone();
    doc.nodes.push({ key: "orphan", attributes: { type: "tester", label: "Orphan", x: 0, y: 200 } });
    const result = compileGraph(doc);
    expect(codes(result)).toContain("unreachable_node");
    expect(result.ok ? undefined : result.errors.find((e) => e.code === "unreachable_node")?.nodeKey).toBe("orphan");
  });

  test("compileGraph rejects a cycle that contains a non-loop edge", () => {
    const doc = clone();
    doc.edges.push({ key: "pr->coder", source: "pr", target: "coder", attributes: { loop: false } });
    expect(codes(compileGraph(doc))).toContain("non_loop_cycle");
  });

  test("compileGraph accepts a cycle through an edge flagged loop with maxAttempts", () => {
    const doc = clone();
    doc.edges.push({
      key: "pr->coder",
      source: "pr",
      target: "coder",
      attributes: { loop: true, maxAttempts: 3, condition: { eq: ["state.feedback.ci.status", "failure"] } } as never,
    });
    expect(compileGraph(doc).ok).toBe(true);
  });

  test("compileGraph rejects a loop edge without maxAttempts", () => {
    const doc = clone();
    doc.edges.push({ key: "pr->coder", source: "pr", target: "coder", attributes: { loop: true } as never });
    expect(codes(compileGraph(doc))).toContain("loop_without_max_attempts");
  });

  test("compileGraph rejects an unknown contract name", () => {
    const doc = clone();
    (doc.nodes[1]!.attributes as Record<string, unknown>).contract = { output: "made_up", checks: [] };
    expect(codes(compileGraph(doc))).toContain("unknown_contract");
  });

  test("compileGraph rejects a condition path outside state, node and edge", () => {
    const doc = clone();
    (doc.edges[0]!.attributes as Record<string, unknown>).condition = { eq: ["process.env.HOME", "x"] };
    expect(codes(compileGraph(doc))).toEqual(["invalid_document"]);
  });
});

describe("compileGraph with the loop fixture", () => {
  test("compileGraph accepts the loop fixture with loops back to the Coder", async () => {
    const loop = (await import("../fixtures/loop.graph.json", { with: { type: "json" } })).default;
    const result = compileGraph(loop);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.graph.inEdges("coder").filter((e) => e.loop).map((e) => e.key).sort()).toEqual(["gate->coder", "pr->coder", "reviewer->coder", "tester->coder"]);
  });

  test("compileGraph rejects an exhaustion target that is not a human gate", () => {
    const doc = clone();
    (doc.attributes as Record<string, unknown>).exhaustedGate = "merge";
    expect(codes(compileGraph(doc))).toContain("invalid_exhausted_gate");
  });

  test("compileGraph rejects an edge onExhausted that does not exist", () => {
    const doc = clone();
    doc.edges.push({ key: "pr->coder", source: "pr", target: "coder", attributes: { loop: true, maxAttempts: 2, onExhausted: "ghost" } as never });
    expect(codes(compileGraph(doc))).toContain("invalid_exhausted_gate");
  });
});

describe("library and secrets", () => {
  test("a node can enable skills, MCP servers and agents from the library", () => {
    const doc = clone();
    (doc.nodes[1]!.attributes as Record<string, unknown>).library = { skills: ["tdd"], mcp: ["docs"], agents: ["explorer"] };
    const result = compileGraph(doc);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.graph.node("coder").library).toEqual({ skills: ["tdd"], mcp: ["docs"], agents: ["explorer"] });
  });

  test("an edge can add library entries for the executions it creates", () => {
    const doc = clone();
    (doc.edges[1]!.attributes as Record<string, unknown>).overrides = { skills: ["ci-triage"] };
    expect(compileGraph(doc).ok).toBe(true);
  });

  test("graph JSON containing a value that looks like a token is rejected", () => {
    const doc = clone();
    (doc.nodes[1]!.attributes as Record<string, unknown>).config = { note: "use ghp_abcdefghijklmnopqrstuvwxyz0123456789" };
    const result = compileGraph(doc);
    expect(codes(result)).toContain("secret_in_graph");
  });
});
