import { describe, expect, test } from "vitest";
import linear from "../fixtures/linear.graph.json" with { type: "json" };
import loop from "../fixtures/loop.graph.json" with { type: "json" };
import { GraphDocumentSchema } from "../schema/graph.ts";
import { compileGraph } from "./compile.ts";
import { portsOf, withPorts } from "./ports.ts";

const ids = (ports: { id: string }[]) => ports.map((p) => p.id);

describe("ports", () => {
  test("each node type has fixed outputs, and planner and coder take feedback", () => {
    expect(ids(portsOf("reviewer", {}).outputs)).toEqual(["approve", "changes"]);
    expect(ids(portsOf("code_review", {}).outputs)).toEqual(["approve", "changes"]);
    expect(ids(portsOf("coder", {}).outputs)).toEqual(["done", "needs_input"]);
    expect(ids(portsOf("tester", {}).outputs)).toEqual(["pass", "fail"]);
    expect(ids(portsOf("pr", {}).outputs)).toEqual(["ready", "fix"]);
    expect(ids(portsOf("planner", {}).inputs)).toEqual(["in", "feedback"]);
    expect(ids(portsOf("reviewer", {}).inputs)).toEqual(["in"]);
  });

  test("a human gate reviews and approves by default, or answers a question", () => {
    expect(ids(portsOf("human_gate", {}).outputs)).toEqual(["approve", "changes"]);
    expect(ids(portsOf("human_gate", { mode: "question" }).outputs)).toEqual(["answered"]);
  });
});

const doc = (edges: { key: string; source: string; target: string; attributes: Record<string, unknown> }[]) => ({
  attributes: { startNode: "planner" },
  nodes: [
    { key: "planner", attributes: { type: "planner", x: 0, y: 0 } },
    { key: "reviewer", attributes: { type: "reviewer", x: 0, y: 0 } },
    { key: "gate", attributes: { type: "human_gate", x: 0, y: 0 } },
  ],
  edges,
});

describe("compiling ports", () => {
  test("a port edge follows the port's outcome, and an edge into feedback loops three times", () => {
    const result = compileGraph(
      doc([
        { key: "planner->reviewer", source: "planner", target: "reviewer", attributes: { port: "done" } },
        { key: "reviewer->planner", source: "reviewer", target: "planner", attributes: { port: "changes", input: "feedback" } },
        { key: "reviewer->gate", source: "reviewer", target: "gate", attributes: { port: "approve" } },
      ]),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const back = result.graph.outEdges("reviewer").find((e) => e.target === "planner")!;
    expect(back).toMatchObject({ on: "passed", condition: { eq: ["node.output.verdict", "request_changes"] }, loop: true, maxAttempts: 3, input: "feedback" });
    expect(result.graph.outEdges("reviewer").find((e) => e.target === "gate")).toMatchObject({ condition: { eq: ["node.output.verdict", "approve"] }, loop: false });
  });

  test("a condition set under Advanced wins over the port's", () => {
    const custom = { eq: ["state.plan.steps", 0] } as const;
    const result = compileGraph(doc([
      { key: "planner->reviewer", source: "planner", target: "reviewer", attributes: { port: "done", condition: custom } },
      { key: "reviewer->gate", source: "reviewer", target: "gate", attributes: { port: "approve" } },
    ]));
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.graph.outEdges("planner")[0]?.condition).toEqual(custom);
  });

  test("an unknown port and feedback into a node without that input are refused", () => {
    const result = compileGraph(doc([
      { key: "planner->reviewer", source: "planner", target: "reviewer", attributes: { port: "approve" } },
      { key: "reviewer->gate", source: "reviewer", target: "gate", attributes: { port: "approve", input: "feedback" } },
    ]));
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual(["unknown_port", "no_feedback_input"]);
  });
});

describe("withPorts", () => {
  test("gives every edge of the fixtures a port and an input, from their conditions", () => {
    for (const fixture of [linear, loop]) {
      const ported = withPorts(GraphDocumentSchema.parse(fixture));
      for (const edge of ported.edges) expect(edge.attributes.port, edge.key).toBeDefined();
    }
    const ported = withPorts(GraphDocumentSchema.parse(loop));
    const edge = (key: string) => ported.edges.find((e) => e.key === key)!.attributes;
    expect(edge("reviewer->coder")).toMatchObject({ port: "changes", input: "feedback" });
    expect(edge("pr->merge")).toMatchObject({ port: "ready", input: "in" });
    expect(edge("gate->coder")).toMatchObject({ port: "answered", input: "feedback" });
    expect(ported.nodes.find((n) => n.key === "gate")!.attributes.config).toMatchObject({ mode: "question" });
  });

  test("the fixtures still compile the same after gaining ports", () => {
    for (const fixture of [linear, loop]) {
      const before = compileGraph(fixture);
      const after = compileGraph(withPorts(GraphDocumentSchema.parse(fixture)));
      if (!before.ok || !after.ok) throw new Error("fixture does not compile");
      for (const edge of before.graph.graph.edges()) {
        const a = before.graph.graph.getEdgeAttributes(edge);
        const b = after.graph.graph.getEdgeAttributes(edge);
        expect({ on: b.on, condition: b.condition ?? null, loop: b.loop }, edge).toEqual({ on: a.on, condition: a.condition ?? null, loop: a.loop });
      }
    }
  });
});
