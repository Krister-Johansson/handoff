import { expect, test } from "vitest";
import planReview from "@handoff/core/fixtures/plan-review.graph.json" with { type: "json" };
import { loopEdgeKeys, viaFromEvent, viaOf } from "./sent-back";

test("the edges that send work back are the graph's loop edges", () => {
  const loops = loopEdgeKeys(planReview);
  expect(loops.has("plan-review->planner")).toBe(true);
  expect(loops.has("approval->planner")).toBe(true);
  expect(loops.has("tester->coder")).toBe(true);
  expect(loops.has("ask->coder")).toBe(true);
  expect(loops.has("planner->plan-review")).toBe(false);
  expect(loopEdgeKeys({ nonsense: true }).size).toBe(0);
});

test("a step names the edge that started it, and an answer-only round's return as answers only", () => {
  expect(viaOf({ kind: "edge", edgeKey: "pr->coder" })).toBe("pr->coder");
  expect(viaOf({ kind: "returned" })).toBe("answers only");
  expect(viaOf({ kind: "start" })).toBeNull();
  expect(viaFromEvent("returned")).toBe("answers only");
  expect(viaFromEvent("pr->coder")).toBe("pr->coder");
});
