import { expect, test } from "vitest";
import loop from "@handoff/core/fixtures/loop.graph.json" with { type: "json" };
import { elkLayout, type LayoutInput, type Point } from "./elk-layout";

const SIZE = { width: 208, height: 76 };

function loopInput(): LayoutInput {
  return {
    nodes: loop.nodes.map((n) => ({ id: n.key, ...SIZE })),
    edges: loop.edges.map((e) => ({ id: e.key, source: e.source, target: e.target, label: e.attributes.condition ? "node.output.passed = false · loop ×3" : undefined, loop: e.attributes.loop })),
  };
}

type Rect = { x: number; y: number; width: number; height: number };
const inside = (p: Point, r: Rect) => p.x > r.x + 1 && p.x < r.x + r.width - 1 && p.y > r.y + 1 && p.y < r.y + r.height - 1;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test("elkLayout places every node without overlaps, flowing left to right along the main path", async () => {
  const { positions } = await elkLayout(loopInput());
  const rects = Object.entries(positions).map(([id, p]) => ({ id, ...p, ...SIZE }));
  expect(rects).toHaveLength(loop.nodes.length);
  for (const a of rects) for (const b of rects) if (a.id !== b.id) expect(overlaps(a, b)).toBe(false);
  const order = ["planner", "coder", "tester", "reviewer", "pr", "merge"];
  for (let i = 1; i < order.length; i++) expect(positions[order[i]!]!.x).toBeGreaterThan(positions[order[i - 1]!]!.x);
});

test("every edge leaves its source on the right and enters its target on the left, in right angles", async () => {
  const input = loopInput();
  const { positions, routes } = await elkLayout(input);
  for (const edge of input.edges) {
    const route = routes[edge.id]!;
    const [first, last] = [route.points[0]!, route.points.at(-1)!];
    expect(first.x).toBeCloseTo(positions[edge.source]!.x + SIZE.width, 0);
    expect(first.y).toBeCloseTo(positions[edge.source]!.y + SIZE.height / 2, 0);
    expect(last.x).toBeCloseTo(positions[edge.target]!.x, 0);
    expect(last.y).toBeCloseTo(positions[edge.target]!.y + SIZE.height / 2, 0);
    for (let i = 1; i < route.points.length; i++) {
      const [a, b] = [route.points[i - 1]!, route.points[i]!];
      expect(Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5).toBe(true);
    }
  }
});

test("no edge passes through a node, including loop edges that run back", async () => {
  const input = loopInput();
  const { positions, routes } = await elkLayout(input);
  const rects = Object.values(positions).map((p) => ({ ...p, ...SIZE }));
  for (const edge of input.edges) {
    const points = routes[edge.id]!.points;
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1]!, points[i]!];
      for (let t = 0.05; t < 1; t += 0.05) {
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        for (const r of rects) expect(inside(p, r)).toBe(false);
      }
    }
  }
});

test("labelled edges get a label position that does not cover a node", async () => {
  const input = loopInput();
  const { positions, routes } = await elkLayout(input);
  const rects = Object.values(positions).map((p) => ({ ...p, ...SIZE }));
  for (const edge of input.edges.filter((e) => e.label)) {
    const label = routes[edge.id]!.label!;
    expect(label).toBeDefined();
    for (const r of rects) expect(overlaps(label, r)).toBe(false);
  }
});
