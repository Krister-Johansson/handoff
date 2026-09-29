import { expect, test } from "vitest";
import { edgeStyle, loopPath } from "./edge-geometry";

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
