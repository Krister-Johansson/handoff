import { expect, test } from "vitest";
import linear from "./fixtures/linear.graph.json" with { type: "json" };
import loop from "./fixtures/loop.graph.json" with { type: "json" };
import planReview from "./fixtures/plan-review.graph.json" with { type: "json" };

test("every template gives its coder a turn budget that grows with the plan", () => {
  for (const template of [linear, loop, planReview]) {
    const coders = template.nodes.filter((n) => n.attributes.type === "coder");
    expect(coders.length).toBeGreaterThan(0);
    for (const coder of coders) expect((coder.attributes as { config?: { maxTurns?: unknown } }).config?.maxTurns).toBe("auto");
  }
});
