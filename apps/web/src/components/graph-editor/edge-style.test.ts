import { expect, test } from "vitest";
import { edgeLabel, edgeStyle, loopPath } from "./edge-geometry";

test("a loop edge renders dashed and a failure edge renders red", () => {
  expect(edgeStyle({ on: "passed", loop: true, priority: 0, maxAttempts: 3 }, false).strokeDasharray).toBe("6 4");
  expect(edgeStyle({ on: "passed", loop: false, priority: 0 }, false).strokeDasharray).toBeUndefined();
  expect(edgeStyle({ on: "failed", loop: false, priority: 0 }, false).stroke).toBe("var(--destructive)");
});

test("a loop edge path arcs below both endpoints with its label under the nodes", () => {
  const [path, , labelY] = loopPath(600, 100, 0, 100);
  expect(path.startsWith("M 600,100 C")).toBe(true);
  expect(labelY).toBeGreaterThan(100 + 60);
});

test("an edge shows its port, and an edge into feedback is a dashed loop of three", () => {
  expect(edgeLabel({ on: "passed", loop: false, priority: 0, port: "approve" })).toBe("approve");
  expect(edgeLabel({ on: "passed", loop: false, priority: 0, port: "changes", input: "feedback" })).toBe("changes · loop ×3");
  expect(edgeLabel({ on: "passed", loop: false, priority: 0, port: "done", condition: { eq: ["state.plan.steps", 0] } })).toMatch(/^done \(custom\)/);
  expect(edgeStyle({ on: "passed", loop: false, priority: 0, port: "changes", input: "feedback" }, false).strokeDasharray).toBe("6 4");
});

test("an edge with an issue draws red", () => {
  expect(edgeStyle({ on: "passed", loop: false, priority: 0, port: "done" }, false, true).stroke).toBe("var(--destructive)");
});
