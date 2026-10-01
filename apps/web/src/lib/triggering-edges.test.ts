import { expect, test } from "vitest";
import { edgeStyle } from "@/components/graph-editor/edge-geometry";
import { triggeringEdges } from "./triggering-edges";

test("the edge that started each node still at work is the one to show, from its latest execution only", () => {
  const edges = triggeringEdges([
    { nodeKey: "coder", status: "passed", via: "planner->coder" },
    { nodeKey: "tester", status: "passed", via: "coder->tester" },
    { nodeKey: "coder", status: "running", via: "tester->coder" },
    { nodeKey: "gate", status: "waiting", via: "coder->gate" },
    { nodeKey: "reviewer", status: "passed", via: "planner->reviewer" },
    { nodeKey: "start", status: "running", via: null },
  ]);
  expect([...edges].sort()).toEqual(["coder->gate", "tester->coder"]);
});

test("an edge that started a node at work stands out", () => {
  expect(edgeStyle(undefined, false, false, true)).toMatchObject({ stroke: "var(--active-dot)", strokeWidth: 2 });
  expect(edgeStyle(undefined, false, false, false)).toMatchObject({ stroke: "var(--input)", strokeWidth: 1.5 });
});
