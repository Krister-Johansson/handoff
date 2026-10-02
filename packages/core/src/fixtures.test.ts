import { expect, test } from "vitest";
import linear from "./fixtures/linear.graph.json" with { type: "json" };
import loop from "./fixtures/loop.graph.json" with { type: "json" };
import planReview from "./fixtures/plan-review.graph.json" with { type: "json" };
import { compileGraph } from "./graph/compile.ts";

test("every template wires the merge node's update port to the PR node", () => {
  for (const template of [linear, loop, planReview]) {
    const compiled = compileGraph(template);
    if (!compiled.ok) throw new Error(compiled.errors.map((e) => e.message).join("; "));
    const { graph } = compiled;
    const merge = graph.order.find((key) => graph.node(key).type === "merge")!;
    const update = graph.outEdges(merge).filter((e) => e.port === "update");
    expect(update.map((e) => graph.node(e.target).type)).toEqual(["pr"]);
  }
});

test("every template gives its coder a turn budget that grows with the plan", () => {
  for (const template of [linear, loop, planReview]) {
    const coders = template.nodes.filter((n) => n.attributes.type === "coder");
    expect(coders.length).toBeGreaterThan(0);
    for (const coder of coders) expect((coder.attributes as { config?: { maxTurns?: unknown } }).config?.maxTurns).toBe("auto");
  }
});
