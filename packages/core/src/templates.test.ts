import { expect, test } from "vitest";
import linear from "./templates/linear.graph.json" with { type: "json" };
import loop from "./templates/loop.graph.json" with { type: "json" };
import planReview from "./templates/plan-review.graph.json" with { type: "json" };
import { compileGraph, validateGraphForSave } from "./graph/compile.ts";

test("every template can be saved: each node fed by several edges has a join mode", () => {
  for (const template of [linear, loop, planReview]) {
    const result = validateGraphForSave(template);
    expect(result.ok ? [] : result.errors.map((e) => e.message)).toEqual([]);
  }
});

test("in the loop and plan templates the PR node goes on at the first of the demo's skipped edge and the Try it gate's approve", () => {
  for (const template of [loop, planReview]) {
    const compiled = compileGraph(template);
    if (!compiled.ok) throw new Error(compiled.errors.map((e) => e.message).join("; "));
    expect(compiled.graph.node("pr").config.join).toBe("any");
  }
});

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

test("every template sends the PR node on to merge through its ready port, so a pull request merged by hand goes on too", () => {
  for (const template of [linear, loop, planReview]) {
    const compiled = compileGraph(template);
    if (!compiled.ok) throw new Error(compiled.errors.map((e) => e.message).join("; "));
    const { graph } = compiled;
    const toMerge = graph.outEdges("pr").filter((e) => graph.node(e.target).type === "merge");
    expect(toMerge.map((e) => e.port)).toEqual(["ready"]);
  }
});

test("the loop and plan templates demo UI changes before a Try it gate, and wire the demo's skipped port past the gate to the PR node", () => {
  for (const template of [loop, planReview]) {
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

test("the linear template has no demo and no Try it gate", () => {
  const types = linear.nodes.map((n) => n.attributes.type);
  expect(types).not.toContain("demo");
  expect(linear.nodes.filter((n) => n.attributes.type === "human_gate")).toEqual([]);
});

test("every template gives its coder a turn budget that grows with the plan", () => {
  for (const template of [linear, loop, planReview]) {
    const coders = template.nodes.filter((n) => n.attributes.type === "coder");
    expect(coders.length).toBeGreaterThan(0);
    for (const coder of coders) expect((coder.attributes as { config?: { maxTurns?: unknown } }).config?.maxTurns).toBe("auto");
  }
});
