import type { Condition } from "../conditions/schema.ts";
import type { GraphDocument, NodeType } from "../schema/graph.ts";

/** A named output of a node: the outcome it follows and, for most, a condition on the node's output. */
export type OutputPort = { id: string; label: string; on: "passed" | "failed"; condition?: Condition; tone?: "back" };
/** in carries the work forward; feedback brings a later attempt what an earlier step sent back. */
export type InputPort = { id: "in" | "feedback"; label: string };
export type NodePorts = { inputs: InputPort[]; outputs: OutputPort[] };

const IN: InputPort = { id: "in", label: "in" };
const FEEDBACK: InputPort = { id: "feedback", label: "feedback" };

const out = (id: string, label: string, condition?: Condition, tone?: "back"): OutputPort => ({
  id,
  label,
  on: "passed",
  ...(condition ? { condition } : {}),
  ...(tone ? { tone } : {}),
});

const OUTPUTS: Record<Exclude<NodeType, "human_gate">, OutputPort[]> = {
  planner: [out("done", "done")],
  coder: [out("done", "done", { eq: ["node.output.status", "done"] }), out("needs_input", "needs input", { eq: ["node.output.status", "needs_input"] })],
  reviewer: [out("approve", "approve", { eq: ["node.output.verdict", "approve"] }), out("changes", "changes", { eq: ["node.output.verdict", "request_changes"] }, "back")],
  code_review: [out("approve", "approve", { eq: ["node.output.verdict", "approve"] }), out("changes", "changes", { eq: ["node.output.verdict", "request_changes"] }, "back")],
  tester: [out("pass", "pass", { eq: ["node.output.passed", true] }), out("fail", "fail", { eq: ["node.output.passed", false] }, "back")],
  pr: [
    out("ready", "ready", { all: [{ eq: ["node.output.feedback.ci.status", "success"] }, { neq: ["node.output.feedback.review.decision", "changes_requested"] }] }),
    out("fix", "fix", { any: [{ eq: ["node.output.feedback.ci.status", "failure"] }, { eq: ["node.output.feedback.review.decision", "changes_requested"] }] }, "back"),
  ],
  merge: [out("merged", "merged")],
  function: [out("done", "done")],
};

const GATE_APPROVAL = [out("approve", "approve", { eq: ["node.output.option", "approve"] }), out("changes", "changes", { in: ["node.output.option", ["changes", "reject"]] }, "back")];
const GATE_QUESTION = [out("answered", "answered", { neq: ["node.output.option", "abort"] })];

/** Whether a human gate reviews what reaches it (approval) or answers a question a coder asked. */
export const gateMode = (config: Record<string, unknown>) => (config.mode === "question" ? "question" : "approval");

/** The fixed inputs and outputs of a node type. Edges connect an output to an input. */
export function portsOf(type: string, config: Record<string, unknown>): NodePorts {
  if (type === "human_gate") return { inputs: [IN], outputs: gateMode(config) === "question" ? GATE_QUESTION : GATE_APPROVAL };
  const outputs = OUTPUTS[type as keyof typeof OUTPUTS] ?? [];
  return { inputs: type === "planner" || type === "coder" ? [IN, FEEDBACK] : [IN], outputs };
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
    const port = candidates.find((p) => p.on === edge.attributes.on && same(p.condition, edge.attributes.condition));
    if (!port) return edge;
    if (port.id === "answered") questionGates.add(edge.source);
    const feedback = edge.attributes.loop && portsOf(target.type, target.config).inputs.some((i) => i.id === "feedback");
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
