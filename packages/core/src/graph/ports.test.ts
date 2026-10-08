import { describe, expect, test } from "vitest";
import linear from "../fixtures/linear.graph.json" with { type: "json" };
import loop from "../fixtures/loop.graph.json" with { type: "json" };
import planReview from "../fixtures/plan-review.graph.json" with { type: "json" };
import { GraphDocumentSchema } from "../schema/graph.ts";
import { compileGraph } from "./compile.ts";
import { evaluateCondition } from "../conditions/evaluate.ts";
import { portsOf, withPorts } from "./ports.ts";

const ids = (ports: { id: string }[]) => ports.map((p) => p.id);

describe("ports", () => {
  test("each node type has fixed outputs, one input, and each output continues or sends feedback", () => {
    expect(ids(portsOf("reviewer", {}).outputs)).toEqual(["approve", "changes"]);
    expect(ids(portsOf("code_review", {}).outputs)).toEqual(["approve", "changes"]);
    expect(ids(portsOf("coder", {}).outputs)).toEqual(["done", "needs_input"]);
    expect(ids(portsOf("tester", {}).outputs)).toEqual(["pass", "fail"]);
    expect(ids(portsOf("pr", {}).outputs)).toEqual(["ready", "fix"]);
    expect(ids(portsOf("merge", {}).outputs)).toEqual(["merged", "update"]);
    // A merge GitHub refuses loops back to the PR node to catch up; a conflict with main goes back on fix, like failing CI.
    expect(portsOf("merge", {}).outputs.find((p) => p.id === "update")?.kind).toBe("continue");
    expect(ids(portsOf("planner", {}).inputs)).toEqual(["in"]);
    expect(ids(portsOf("reviewer", {}).inputs)).toEqual(["in"]);
    expect(portsOf("tester", {}).outputs.map((p) => [p.id, p.kind])).toEqual([
      ["pass", "continue"],
      ["fail", "feedback"],
    ]);
    expect(portsOf("human_gate", { mode: "question" }).outputs[0]?.kind).toBe("feedback");
  });

  test("a human gate reviews and approves by default, or answers a question", () => {
    expect(ids(portsOf("human_gate", {}).outputs)).toEqual(["approve", "changes"]);
    expect(ids(portsOf("human_gate", { mode: "question" }).outputs)).toEqual(["answered"]);
  });
});

const doc = (edges: { key: string; source: string; target: string; attributes: Record<string, unknown> }[]) => ({
  attributes: { startNode: "planner" },
  nodes: [
    { key: "planner", attributes: { type: "planner", x: 0, y: 0 } },
    { key: "reviewer", attributes: { type: "reviewer", x: 0, y: 0 } },
    { key: "gate", attributes: { type: "human_gate", x: 0, y: 0 } },
  ],
  edges,
});

describe("compiling ports", () => {
  test("a port edge follows the port's outcome, and a feedback port makes a loop of three whatever input was stored", () => {
    const result = compileGraph(
      doc([
        { key: "planner->reviewer", source: "planner", target: "reviewer", attributes: { port: "done" } },
        { key: "reviewer->planner", source: "reviewer", target: "planner", attributes: { port: "changes" } },
        { key: "reviewer->gate", source: "reviewer", target: "gate", attributes: { port: "approve" } },
      ]),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const back = result.graph.outEdges("reviewer").find((e) => e.target === "planner")!;
    expect(back).toMatchObject({ on: "passed", condition: { eq: ["node.output.verdict", "request_changes"] }, loop: true, maxAttempts: 3, input: "feedback" });
    expect(result.graph.outEdges("reviewer").find((e) => e.target === "gate")).toMatchObject({ condition: { eq: ["node.output.verdict", "approve"] }, loop: false });
  });

  test("a condition set under Advanced wins over the port's", () => {
    const custom = { eq: ["state.plan.steps", 0] } as const;
    const result = compileGraph(doc([
      { key: "planner->reviewer", source: "planner", target: "reviewer", attributes: { port: "done", condition: custom } },
      { key: "reviewer->gate", source: "reviewer", target: "gate", attributes: { port: "approve" } },
    ]));
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.graph.outEdges("planner")[0]?.condition).toEqual(custom);
  });

  test("an unknown port and feedback into a node that cannot use it are refused", () => {
    const result = compileGraph(doc([
      { key: "planner->reviewer", source: "planner", target: "reviewer", attributes: { port: "approve" } },
      { key: "reviewer->gate", source: "reviewer", target: "gate", attributes: { port: "changes" } },
    ]));
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual(expect.arrayContaining(["unknown_port", "no_feedback_input"]));
  });

  test("a continue port into a node is a plain edge even if feedback was stored", () => {
    const result = compileGraph(doc([
      { key: "planner->reviewer", source: "planner", target: "reviewer", attributes: { port: "done", input: "feedback" } },
      { key: "reviewer->gate", source: "reviewer", target: "gate", attributes: { port: "approve" } },
    ]));
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.graph.outEdges("planner")[0]).toMatchObject({ loop: false, input: "in" });
  });
});

describe("withPorts", () => {
  test("gives every edge of the fixtures a port and an input, from their conditions", () => {
    for (const fixture of [linear, loop]) {
      const ported = withPorts(GraphDocumentSchema.parse(fixture));
      for (const edge of ported.edges) expect(edge.attributes.port, edge.key).toBeDefined();
    }
    const ported = withPorts(GraphDocumentSchema.parse(loop));
    const edge = (key: string) => ported.edges.find((e) => e.key === key)!.attributes;
    expect(edge("reviewer->coder")).toMatchObject({ port: "changes", input: "feedback" });
    expect(edge("pr->merge")).toMatchObject({ port: "ready", input: "in" });
    expect(edge("gate->coder")).toMatchObject({ port: "answered", input: "feedback" });
    expect(ported.nodes.find((n) => n.key === "gate")!.attributes.config).toMatchObject({ mode: "question" });
  });

  test("the fixtures still compile the same after gaining ports", () => {
    for (const fixture of [linear, loop]) {
      const before = compileGraph(fixture);
      const after = compileGraph(withPorts(GraphDocumentSchema.parse(fixture)));
      if (!before.ok || !after.ok) throw new Error("fixture does not compile");
      for (const edge of before.graph.graph.edges()) {
        const a = before.graph.graph.getEdgeAttributes(edge);
        const b = after.graph.graph.getEdgeAttributes(edge);
        // A planner's done now excludes its questions; for outputs without a status it routes the same.
        const planner = before.graph.graph.source(edge) === "planner" && a.condition === undefined;
        // A PR node's fix now also takes conflicts with main.
        const prFix = before.graph.graph.source(edge) === "pr" && b.port === "fix";
        // And its ready also takes a pull request a person merged on GitHub.
        const prReady = before.graph.graph.source(edge) === "pr" && b.port === "ready";
        const prPort = prFix || prReady ? portsOf("pr", {}).outputs.find((p) => p.id === b.port)!.condition : undefined;
        const expected = planner ? { neq: ["node.output.status", "needs_input"] } : (prPort ?? a.condition ?? null);
        expect({ on: b.on, condition: b.condition ?? null, loop: b.loop }, edge).toEqual({ on: a.on, condition: expected, loop: a.loop });
      }
    }
  });
});

test("the plan, review, approve, build graph compiles, and every way back to an agent is a feedback loop", () => {
  const result = compileGraph(planReview);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  const loops = result.graph.graph.edges().map((e) => result.graph.graph.getEdgeAttributes(e)).filter((e) => e.loop);
  // A merge that finds the branch behind sends it back to the PR node to catch up, which takes no feedback.
  expect(loops.find((e) => e.key === "merge->pr")).toMatchObject({ port: "update", input: "in", maxAttempts: 3 });
  const back = loops.filter((e) => e.key !== "merge->pr");
  expect(back.map((e) => e.key).sort()).toEqual(["approval->planner", "ask->coder", "plan-review->planner", "pr->coder", "tester->coder"]);
  expect(back.every((e) => e.input === "feedback")).toBe(true);
  // A person decides every answer at the question gate, so its loop has no round limit.
  expect(back.filter((e) => e.key !== "ask->coder").every((e) => e.maxAttempts === 3)).toBe(true);
  expect(back.find((e) => e.key === "ask->coder")?.maxAttempts).toBeUndefined();
  expect(result.graph.order.slice(0, 5)).toEqual(["start", "planner", "plan-review", "approval", "coder"]);
  expect(result.graph.order.at(-1)).toBe("finish");
});

describe("Start and Finish", () => {
  const flow = (edges: { key: string; source: string; target: string; attributes: Record<string, unknown> }[], extra: { key: string; attributes: Record<string, unknown> }[] = []) => ({
    attributes: { startNode: "start" },
    nodes: [
      { key: "start", attributes: { type: "start", config: { trigger: "run" }, x: 0, y: 0 } },
      { key: "planner", attributes: { type: "planner", x: 0, y: 0 } },
      { key: "finish", attributes: { type: "finish", config: { notify: true }, x: 0, y: 0 } },
      ...extra,
    ],
    edges,
  });

  test("Start has a run output and no input; Finish has an input and no outputs", () => {
    expect(portsOf("start", {})).toEqual({ inputs: [], outputs: [expect.objectContaining({ id: "run", kind: "continue" })] });
    expect(portsOf("finish", {})).toEqual({ inputs: [{ id: "in", label: "in" }], outputs: [] });
  });

  test("a graph from Start through a step to Finish compiles", () => {
    const result = compileGraph(flow([
      { key: "start->planner", source: "start", target: "planner", attributes: { port: "run" } },
      { key: "planner->finish", source: "planner", target: "finish", attributes: { port: "done" } },
    ]));
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.graph.executorKind("start")).toBe("function");
    expect(result.graph.order).toEqual(["start", "planner", "finish"]);
  });

  test("only one Start, it is where the run starts, nothing leads into it, and nothing leaves Finish", () => {
    const codes = (doc: unknown) => {
      const result = compileGraph(doc);
      return result.ok ? [] : result.errors.map((e) => e.code);
    };
    expect(codes(flow([{ key: "start->planner", source: "start", target: "planner", attributes: { port: "run" } }], [{ key: "start-2", attributes: { type: "start", x: 0, y: 0 } }]))).toContain("invalid_start");
    expect(codes({ ...flow([{ key: "start->planner", source: "start", target: "planner", attributes: { port: "run" } }]), attributes: { startNode: "planner" } })).toContain("invalid_start");
    expect(codes(flow([
      { key: "start->planner", source: "start", target: "planner", attributes: { port: "run" } },
      { key: "planner->start", source: "planner", target: "start", attributes: { port: "done" } },
    ]))).toContain("invalid_start");
    expect(codes(flow([
      { key: "start->planner", source: "start", target: "planner", attributes: { port: "run" } },
      { key: "planner->finish", source: "planner", target: "finish", attributes: { port: "done" } },
      { key: "finish->planner", source: "finish", target: "planner", attributes: {} },
    ]))).toContain("invalid_finish");
  });
});

test("a planner can ask: needs input next to done, and an old output without a status still counts as done", () => {
  const ports = portsOf("planner", {}).outputs;
  expect(ports.map((p) => p.id)).toEqual(["done", "needs_input"]);
  const done = ports.find((p) => p.id === "done")!.condition!;
  expect(evaluateCondition(done, { node: { output: { plan: "p", steps: [], ownedPaths: [] } } } as never)).toBe(true);
  expect(evaluateCondition(done, { node: { output: { status: "needs_input" } } } as never)).toBe(false);
});

test("a pull request a person merged on GitHub leaves the PR node through ready, whatever CI said, and never through fix", () => {
  const [ready, fix] = portsOf("pr", {}).outputs;
  const merged = { sync: "clean", merged: true, prNumber: 292, prUrl: "u", headSha: "abc" };
  expect(evaluateCondition(ready!.condition!, { node: { output: merged } } as never)).toBe(true);
  expect(evaluateCondition(fix!.condition!, { node: { output: merged } } as never)).toBe(false);
  // Still open with CI pending: neither, so the step keeps waiting.
  const pending = { sync: "clean", prNumber: 292, prUrl: "u", headSha: "abc", feedback: { ci: { status: "pending" }, review: { decision: "approved" } } };
  expect(evaluateCondition(ready!.condition!, { node: { output: pending } } as never)).toBe(false);
});

test("a graph saved before a merged pull request went on through ready finds the ready port from its old condition", () => {
  const ported = withPorts(GraphDocumentSchema.parse(linear));
  const edge = ported.edges.find((e) => e.key === "pr->merge")!.attributes;
  expect(edge).toMatchObject({ port: "ready", input: "in" });
  expect(edge.condition).toBeUndefined();
});
