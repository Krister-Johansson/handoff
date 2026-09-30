import { expect, test } from "vitest";
import planReview from "@handoff/core/fixtures/plan-review.graph.json" with { type: "json" };
import { loopEdgeKeys } from "./sent-back";

test("the edges that send work back are the graph's loop edges", () => {
  const loops = loopEdgeKeys(planReview);
  expect(loops.has("plan-review->planner")).toBe(true);
  expect(loops.has("approval->planner")).toBe(true);
  expect(loops.has("tester->coder")).toBe(true);
  expect(loops.has("ask->coder")).toBe(true);
  expect(loops.has("planner->plan-review")).toBe(false);
  expect(loopEdgeKeys({ nonsense: true }).size).toBe(0);
});
