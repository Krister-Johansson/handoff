import { expect, test } from "vitest";
import { edgeLabel, edgeStyle, edgeTone, loopPath } from "./edge-geometry";

test("a loop edge renders red and dashed, and a failure edge renders red", () => {
  expect(edgeStyle({ on: "passed", loop: true, priority: 0, maxAttempts: 3 }, false)).toMatchObject({ strokeDasharray: "4 3", stroke: "var(--danger-dot)" });
  expect(edgeStyle({ on: "passed", loop: false, priority: 0 }, false).strokeDasharray).toBeUndefined();
  expect(edgeStyle({ on: "failed", loop: false, priority: 0 }, false).stroke).toBe("var(--danger-dot)");
});

test("a forward edge draws in the strong border colour", () => {
  expect(edgeStyle({ on: "passed", loop: false, priority: 0, port: "approved" }, false)).toMatchObject({ stroke: "var(--input)", strokeWidth: 1.5 });
});

test("an edge that started a node at work draws in the active colour, dashed so it can animate", () => {
  expect(edgeStyle({ on: "passed", loop: true, priority: 0, port: "changes" }, false, false, true)).toMatchObject({ stroke: "var(--active-dot)", strokeDasharray: "6 4", strokeWidth: 2 });
});

test("a loop edge path arcs below both endpoints with its label under the nodes", () => {
  const [path, , labelY] = loopPath(600, 100, 0, 100);
  expect(path.startsWith("M 600,100 C")).toBe(true);
  expect(labelY).toBeGreaterThan(100 + 60);
});

test("an edge shows its port, and an edge into feedback is a loop of at most three", () => {
  expect(edgeLabel({ on: "passed", loop: false, priority: 0, port: "approve" })).toBe("approve");
  expect(edgeLabel({ on: "passed", loop: false, priority: 0, port: "changes", input: "feedback" })).toBe("changes · max 3");
  expect(edgeLabel({ on: "passed", loop: true, priority: 0, port: "failed", maxAttempts: 2 })).toBe("failed · max 2");
  expect(edgeLabel({ on: "passed", loop: false, priority: 0, port: "done", condition: { eq: ["state.plan.steps", 0] } })).toMatch(/^done \(custom\)/);
  expect(edgeStyle({ on: "passed", loop: false, priority: 0, port: "changes", input: "feedback" }, false).strokeDasharray).toBe("4 3");
});

test("an edge with an issue draws in the destructive colour", () => {
  expect(edgeStyle({ on: "passed", loop: false, priority: 0, port: "done" }, false, true).stroke).toBe("var(--destructive)");
});

test("an edge label takes the tone of its edge: active first, then selected, then a loop", () => {
  const loop = { on: "passed", loop: true, priority: 0, port: "changes" } as const;
  expect(edgeTone(loop, false, true)).toBe("active");
  expect(edgeTone(loop, true, false)).toBe("selected");
  expect(edgeTone(loop, false, false)).toBe("loop");
  expect(edgeTone({ on: "passed", loop: false, priority: 0, port: "approved" }, false, false)).toBe("plain");
});
