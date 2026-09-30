import { expect, test } from "vitest";
import { MAX_LABEL_CHARS } from "@/lib/elk-layout";
import { edgeLabel, roundedPath, routeFor } from "./edge-geometry";

test("roundedPath draws straight segments with rounded corners between them", () => {
  expect(roundedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }])).toBe("M 0,0 L 100,0");
  expect(roundedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }], 8)).toBe("M 0,0 L 92,0 Q 100,0 100,8 L 100,50");
});

test("roundedPath shrinks the corner radius on short segments", () => {
  expect(roundedPath([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 40 }], 8)).toBe("M 0,0 L 3,0 Q 6,0 6,3 L 6,40");
});

const route = { points: [{ x: 208, y: 38 }, { x: 240, y: 38 }, { x: 240, y: 140 }, { x: 300, y: 140 }] };

test("routeFor uses the layout route when the handles are where the layout put them, snapped to the handles", () => {
  const points = routeFor(route, { sourceX: 209, sourceY: 39, targetX: 299, targetY: 141 });
  expect(points).toEqual([
    { x: 209, y: 39 },
    { x: 240, y: 39 },
    { x: 240, y: 141 },
    { x: 299, y: 141 },
  ]);
});

test("routeFor gives up when a node moved since the layout", () => {
  expect(routeFor(route, { sourceX: 208, sourceY: 38, targetX: 420, targetY: 140 })).toBeUndefined();
  expect(routeFor(undefined, { sourceX: 0, sourceY: 0, targetX: 0, targetY: 0 })).toBeUndefined();
});

test("edgeLabel joins the trigger, the condition and the loop budget, capped for the layout", () => {
  expect(edgeLabel({ on: "passed", loop: true, maxAttempts: 3, priority: 0, condition: { eq: ["node.output.passed", false] } })).toBe("passed = false · loop ×3");
  expect(edgeLabel({ on: "failed", loop: false, priority: 0 })).toBe("on failed");
  const long = edgeLabel({ on: "passed", loop: true, maxAttempts: 3, priority: 0, condition: { any: [{ eq: ["node.output.feedback.ci.status", "failure"] }, { eq: ["node.output.feedback.review.decision", "changes_requested"] }] } });
  expect(long.length).toBeLessThanOrEqual(MAX_LABEL_CHARS);
  expect(long.endsWith("…")).toBe(true);
});
