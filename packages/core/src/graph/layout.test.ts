import { expect, test } from "vitest";
import loop from "../fixtures/loop.graph.json" with { type: "json" };
import { toReactFlow } from "./react-flow.ts";
import { layoutFlow, NODE_HEIGHT, NODE_WIDTH } from "./layout.ts";

test("layout puts every node to the right of its non-loop predecessors", () => {
  const flow = layoutFlow(toReactFlow(loop));
  const x = (id: string) => flow.nodes.find((n) => n.id === id)!.position.x;
  for (const edge of flow.edges.filter((e) => !e.data.loop)) {
    if (flow.nodes.find((n) => n.id === edge.target)!.data.nodeType === "human_gate") continue;
    expect(x(edge.target)).toBeGreaterThan(x(edge.source));
  }
});

test("layout keeps nodes from overlapping", () => {
  const { nodes } = layoutFlow(toReactFlow(loop));
  for (const a of nodes)
    for (const b of nodes) {
      if (a === b) continue;
      const apart = Math.abs(a.position.x - b.position.x) >= NODE_WIDTH || Math.abs(a.position.y - b.position.y) >= NODE_HEIGHT;
      expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
    }
});

test("layout puts human gates on a row above the main path, clear of loop arcs", () => {
  const { nodes } = layoutFlow(toReactFlow(loop));
  const gate = nodes.find((n) => n.id === "gate")!;
  const coder = nodes.find((n) => n.id === "coder")!;
  expect(gate.position.y).toBeLessThan(coder.position.y);
});
