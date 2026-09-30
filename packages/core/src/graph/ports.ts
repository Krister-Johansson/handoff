import type { Condition } from "../conditions/schema.ts";
import type { GraphDocument, NodeType } from "../schema/graph.ts";

/**
 * A named output of a node: the outcome it follows and, for most, a condition on the node's output.
 * A continue port carries the work forward; a feedback port sends it back to an earlier step, as a
 * bounded loop that brings along what this node reported.
 */
export type OutputPort = { id: string; label: string; on: "passed" | "failed"; condition?: Condition; kind: "continue" | "feedback" };
/** Every node has one input; what an edge into it means comes from the port it leaves. */
export type InputPort = { id: "in"; label: string };
export type NodePorts = { inputs: InputPort[]; outputs: OutputPort[] };

const IN: InputPort = { id: "in", label: "in" };

const out = (id: string, label: string, condition?: Condition, kind: OutputPort["kind"] = "continue"): OutputPort => ({
  id,
  label,
  on: "passed",
  kind,
  ...(condition ? { condition } : {}),
});

/** The node types that run an agent, so they can use what a feedback edge brings. */
export const FEEDBACK_TARGETS = new Set(["planner", "coder", "reviewer", "code_review"]);

const OUTPUTS: Record<Exclude<NodeType, "human_gate" | "start" | "finish">, OutputPort[]> = {
  planner: [out("done", "done", { neq: ["node.output.status", "needs_input"] }), out("needs_input", "needs input", { eq: ["node.output.status", "needs_input"] })],
  coder: [out("done", "done", { eq: ["node.output.status", "done"] }), out("needs_input", "needs input", { eq: ["node.output.status", "needs_input"] })],
  reviewer: [out("approve", "approve", { eq: ["node.output.verdict", "approve"] }), out("changes", "changes", { eq: ["node.output.verdict", "request_changes"] }, "feedback")],
  code_review: [out("approve", "approve", { eq: ["node.output.verdict", "approve"] }), out("changes", "changes", { eq: ["node.output.verdict", "request_changes"] }, "feedback")],
  tester: [out("pass", "pass", { eq: ["node.output.passed", true] }), out("fail", "fail", { eq: ["node.output.passed", false] }, "feedback")],
  pr: [
    out("ready", "ready", { all: [{ eq: ["node.output.feedback.ci.status", "success"] }, { neq: ["node.output.feedback.review.decision", "changes_requested"] }] }),
    out("fix", "fix", { any: [{ eq: ["node.output.feedback.ci.status", "failure"] }, { eq: ["node.output.feedback.review.decision", "changes_requested"] }] }, "feedback"),
  ],
  merge: [out("merged", "merged")],
  function: [out("done", "done")],
};

const GATE_APPROVAL = [out("approve", "approve", { eq: ["node.output.option", "approve"] }), out("changes", "changes", { in: ["node.output.option", ["changes", "reject"]] }, "feedback")];
const GATE_QUESTION = [out("answered", "answered", { neq: ["node.output.option", "abort"] }, "feedback")];

/** Whether a human gate reviews what reaches it (approval) or answers a question a coder asked. */
export const gateMode = (config: Record<string, unknown>) => (config.mode === "question" ? "question" : "approval");

/** Whether an edge leaving `port` of a node sends feedback back or continues the work. */
export function portKind(type: string, config: Record<string, unknown>, port: string | undefined): OutputPort["kind"] | undefined {
  if (!port) return undefined;
  const all = type === "human_gate" ? [...GATE_APPROVAL, ...GATE_QUESTION] : portsOf(type, config).outputs;
  return all.find((p) => p.id === port)?.kind;
}

/** The fixed inputs and outputs of a node type. Edges connect an output to an input. */
export function portsOf(type: string, config: Record<string, unknown>): NodePorts {
  if (type === "human_gate") return { inputs: [IN], outputs: gateMode(config) === "question" ? GATE_QUESTION : GATE_APPROVAL };
  // Start begins the graph with the run's task and issues; Finish ends it.
  if (type === "start") return { inputs: [], outputs: [out("run", "run")] };
  if (type === "finish") return { inputs: [IN], outputs: [] };
  const outputs = OUTPUTS[type as keyof typeof OUTPUTS] ?? [];
  return { inputs: [IN], outputs };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Graphs saved before ports: gives each edge the port whose outcome and condition it has, and the
 * feedback input when it loops back into a planner or coder. A gate with an answered edge is a
 * question gate. Edges that match no port keep their custom condition.
 */
export function withPorts(document: GraphDocument): GraphDocument {
  const nodes = new Map(document.nodes.map((n) => [n.key, n]));
  const questionGates = new Set<string>();
  const edges = document.edges.map((edge) => {
    const source = nodes.get(edge.source)?.attributes;
    const target = nodes.get(edge.target)?.attributes;
    if (!source || !target || edge.attributes.port) return edge;
    const candidates = source.type === "human_gate" ? [...GATE_APPROVAL, ...GATE_QUESTION] : portsOf(source.type, source.config).outputs;
    // Before planners could ask, their done port had no condition, so an unconditioned planner edge is done.
    const plannerDone = source.type === "planner" && !edge.attributes.condition ? candidates.find((p) => p.id === "done") : undefined;
    const port = plannerDone ?? candidates.find((p) => p.on === edge.attributes.on && same(p.condition, edge.attributes.condition));
    if (!port) return edge;
    if (port.id === "answered") questionGates.add(edge.source);
    const feedback = port.kind === "feedback";
    const { condition: _matched, ...rest } = edge.attributes;
    return { ...edge, attributes: { ...rest, port: port.id, input: feedback ? ("feedback" as const) : ("in" as const) } };
  });
  return {
    ...document,
    nodes: document.nodes.map((n) =>
      questionGates.has(n.key) && n.attributes.config.mode === undefined ? { ...n, attributes: { ...n.attributes, config: { ...n.attributes.config, mode: "question" } } } : n,
    ),
    edges,
  };
}
