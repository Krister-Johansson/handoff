import { describe, expect, test } from "vitest";
import linear from "../fixtures/linear.graph.json" with { type: "json" };
import loop from "../fixtures/loop.graph.json" with { type: "json" };
import { GraphDocumentSchema } from "../schema/graph.ts";
import { fromReactFlow, toReactFlow } from "./react-flow.ts";

const normalize = (value: unknown) => JSON.parse(JSON.stringify(value));

describe("React Flow mapping", () => {
  test("toReactFlow maps node attributes to node data and x/y to position", () => {
    const flow = toReactFlow(linear);
    const coder = flow.nodes.find((n) => n.id === "coder")!;
    const stored = linear.nodes.find((n) => n.key === "coder")!.attributes;
    expect(coder).toMatchObject({ id: "coder", type: "handoff", position: { x: stored.x, y: stored.y }, data: { nodeType: "coder", label: "Code", isStart: false } });
    expect(flow.nodes.find((n) => n.id === "planner")!.data.isStart).toBe(true);
    expect(flow.edges.find((e) => e.id === "coder->pr")).toMatchObject({ source: "coder", target: "pr", type: "handoff", data: { loop: false, condition: { eq: ["node.output.status", "done"] } } });
  });

  test("fromReactFlow(toReactFlow(g)) round-trips the linear and loop fixtures", () => {
    for (const fixture of [linear, loop]) {
      expect(normalize(fromReactFlow(toReactFlow(fixture)))).toEqual(normalize(GraphDocumentSchema.parse(fixture)));
    }
  });

  test("fromReactFlow keeps loop flag, maxAttempts and exhaustion targets on edges", () => {
    const doc = fromReactFlow(toReactFlow(loop));
    expect(doc.edges.find((e) => e.key === "tester->coder")!.attributes).toMatchObject({ loop: true, maxAttempts: 3 });
    expect(doc.attributes.exhaustedGate).toBe("gate");
  });

  test("a dragged position updates only x and y", () => {
    const flow = toReactFlow(linear);
    const moved = { ...flow, nodes: flow.nodes.map((n) => (n.id === "pr" ? { ...n, position: { x: 999, y: 42.4 } } : n)) };
    const doc = fromReactFlow(moved);
    const pr = doc.nodes.find((n) => n.key === "pr")!.attributes;
    expect({ x: pr.x, y: pr.y }).toEqual({ x: 999, y: 42 });
    expect(normalize({ ...pr, x: 0, y: 0 })).toEqual(normalize({ ...GraphDocumentSchema.parse(linear).nodes.find((n) => n.key === "pr")!.attributes, x: 0, y: 0 }));
  });
});
