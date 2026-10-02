import { expect, test } from "vitest";
import linear from "./templates/linear.graph.json" with { type: "json" };
import loop from "./templates/loop.graph.json" with { type: "json" };
import planReview from "./templates/plan-review.graph.json" with { type: "json" };
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

test("every template demos UI changes before a Try it gate, and wires the demo's skipped port past the gate to the PR node", () => {
  for (const template of [linear, loop, planReview]) {
    const compiled = compileGraph(template);
    if (!compiled.ok) throw new Error(compiled.errors.map((e) => e.message).join("; "));
    const { graph } = compiled;
    const demo = graph.order.find((key) => graph.node(key).type === "demo")!;
    expect(graph.node(demo).config.when).toBe("ui_changes");
    const target = (port: string) => graph.outEdges(demo).filter((e) => e.port === port).map((e) => graph.node(e.target));
    const [gate] = target("done");
    expect(gate).toMatchObject({ type: "human_gate", config: { mode: "try" } });
    expect(target("skipped").map((n) => n.type)).toEqual(["pr"]);
    expect(graph.outEdges(gate!.key).filter((e) => e.port === "approve").map((e) => graph.node(e.target).type)).toEqual(["pr"]);
    expect(graph.outEdges(gate!.key).filter((e) => e.port === "changes").map((e) => graph.node(e.target).type)).toEqual(["coder"]);
  }
});

test("every template gives its coder a turn budget that grows with the plan", () => {
  for (const template of [linear, loop, planReview]) {
    const coders = template.nodes.filter((n) => n.attributes.type === "coder");
    expect(coders.length).toBeGreaterThan(0);
    for (const coder of coders) expect((coder.attributes as { config?: { maxTurns?: unknown } }).config?.maxTurns).toBe("auto");
  }
});
