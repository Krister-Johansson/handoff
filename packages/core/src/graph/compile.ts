import { DirectedGraph } from "graphology";
import { hasCycle, topologicalSort } from "graphology-dag";
import { bfsFromNode } from "graphology-traversal";
import { ContextSelectorSchema, isContractName, type Contract, type ContextSelector } from "../schema/contracts.ts";
import {
  GraphDocumentSchema,
  type EdgeAttributes,
  type ExecutorKind,
  type GraphDocument,
  type NodeType,
} from "../schema/graph.ts";
import { passEnvProblem } from "../secrets/pass-env.ts";
import { isNodeType, nodeCatalog } from "./catalog.ts";

export type CompileErrorCode =
  | "invalid_document"
  | "unknown_node_type"
  | "duplicate_key"
  | "unknown_edge_endpoint"
  | "missing_start_node"
  | "unreachable_node"
  | "non_loop_cycle"
  | "loop_without_max_attempts"
  | "unknown_contract"
  | "invalid_exhausted_gate"
  | "secret_in_graph"
  | "invalid_pass_env";

export type CompileError = { code: CompileErrorCode; message: string; nodeKey?: string; edgeKey?: string };

export type CompiledNode = {
  key: string;
  type: NodeType;
  label: string;
  config: Record<string, unknown>;
  contract: Contract;
  contextSelector: ContextSelector;
  library: { skills: string[]; mcp: string[]; agents: string[]; groups: string[] };
  x: number;
  y: number;
};

export type CompiledEdge = EdgeAttributes & { key: string; source: string; target: string };

export type CompiledGraph = {
  document: GraphDocument;
  startNode: string;
  /** Topological order over non-loop edges. */
  order: string[];
  graph: DirectedGraph<CompiledNode, CompiledEdge>;
  node(key: string): CompiledNode;
  executorKind(key: string): ExecutorKind;
  outEdges(key: string): CompiledEdge[];
  inEdges(key: string): CompiledEdge[];
};

export type CompileResult = { ok: true; graph: CompiledGraph } | { ok: false; errors: CompileError[] };

/** Token shapes that must never be stored in a graph: GitHub, Anthropic, Slack, AWS, OpenAI. */
export const SECRET_PATTERN = /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9_-]{16,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{32,})\b/;

/** True when a string contains something shaped like a credential. */
export const looksLikeSecret = (value: string) => SECRET_PATTERN.test(value);

function findSecret(value: unknown, path: string): string | undefined {
  if (typeof value === "string") return SECRET_PATTERN.test(value) ? path : undefined;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findSecret(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const hit = findSecret(v, path ? `${path}.${k}` : k);
      if (hit) return hit;
    }
  }
  return undefined;
}

export function compileGraph(input: unknown): CompileResult {
  const secretAt = findSecret(input, "");
  if (secretAt) {
    return { ok: false, errors: [{ code: "secret_in_graph", message: `${secretAt} looks like a credential; reference secrets from the library as \${secret:NAME} instead` }] };
  }
  const parsed = GraphDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        code: "invalid_document" as const,
        message: `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      })),
    };
  }
  const document = parsed.data;
  const errors: CompileError[] = [];
  const graph = new DirectedGraph<CompiledNode, CompiledEdge>();
  const acyclic = new DirectedGraph();

  for (const { key, attributes } of document.nodes) {
    if (graph.hasNode(key)) {
      errors.push({ code: "duplicate_key", message: `duplicate node key ${key}`, nodeKey: key });
      continue;
    }
    if (!isNodeType(attributes.type)) {
      errors.push({ code: "unknown_node_type", message: `node ${key} has unknown type ${attributes.type}`, nodeKey: key });
      continue;
    }
    const entry = nodeCatalog[attributes.type];
    const contract = attributes.contract ?? { output: entry.contract, checks: [] };
    if (!isContractName(contract.output)) {
      errors.push({ code: "unknown_contract", message: `node ${key} uses unknown contract ${contract.output}`, nodeKey: key });
    }
    const passEnvs = [
      ...(attributes.config.passEnv !== undefined ? [attributes.config.passEnv] : []),
      ...contract.checks.flatMap((c) => ("passEnv" in c && c.passEnv !== undefined ? [c.passEnv] : [])),
    ];
    for (const names of passEnvs) {
      const problem = passEnvProblem(names);
      if (problem) errors.push({ code: "invalid_pass_env", message: `node ${key}: ${problem}`, nodeKey: key });
    }
    graph.addNode(key, {
      key,
      type: attributes.type,
      label: attributes.label ?? key,
      config: attributes.config,
      contract,
      contextSelector: attributes.contextSelector ?? ContextSelectorSchema.parse({}),
      library: {
        skills: attributes.library?.skills ?? [],
        mcp: attributes.library?.mcp ?? [],
        agents: attributes.library?.agents ?? [],
        groups: attributes.library?.groups ?? [],
      },
      x: attributes.x,
      y: attributes.y,
    });
    acyclic.addNode(key);
  }

  for (const edge of document.edges) {
    const { key, source, target, attributes } = edge;
    if (!graph.hasNode(source) || !graph.hasNode(target)) {
      errors.push({ code: "unknown_edge_endpoint", message: `edge ${key} connects ${source} to ${target}`, edgeKey: key });
      continue;
    }
    if (graph.hasEdge(key)) {
      errors.push({ code: "duplicate_key", message: `duplicate edge key ${key}`, edgeKey: key });
      continue;
    }
    if (attributes.loop && attributes.maxAttempts === undefined) {
      errors.push({ code: "loop_without_max_attempts", message: `loop edge ${key} needs maxAttempts`, edgeKey: key });
    }
    graph.addDirectedEdgeWithKey(key, source, target, { ...attributes, key, source, target });
    if (!attributes.loop && !acyclic.hasEdge(source, target)) acyclic.addDirectedEdge(source, target);
  }

  const startNode = document.attributes.startNode;
  if (!graph.hasNode(startNode)) {
    errors.push({ code: "missing_start_node", message: `start node ${startNode} does not exist`, nodeKey: startNode });
  } else {
    const reached = new Set<string>();
    bfsFromNode(graph, startNode, (node) => {
      reached.add(node);
    });
    graph.forEachNode((node) => {
      if (!reached.has(node)) {
        errors.push({ code: "unreachable_node", message: `node ${node} is unreachable from ${startNode}`, nodeKey: node });
      }
    });
  }

  const gates = [
    ...(document.attributes.exhaustedGate ? [{ key: document.attributes.exhaustedGate, edgeKey: undefined as string | undefined }] : []),
    ...document.edges.filter((e) => e.attributes.onExhausted).map((e) => ({ key: e.attributes.onExhausted!, edgeKey: e.key as string | undefined })),
  ];
  for (const gate of gates) {
    if (!graph.hasNode(gate.key) || graph.getNodeAttributes(gate.key).type !== "human_gate") {
      errors.push({
        code: "invalid_exhausted_gate",
        message: `exhaustion target ${gate.key} must be an existing human_gate node`,
        nodeKey: gate.key,
        ...(gate.edgeKey ? { edgeKey: gate.edgeKey } : {}),
      });
    }
  }

  if (hasCycle(acyclic)) {
    errors.push({ code: "non_loop_cycle", message: "graph has a cycle that does not go through a loop edge" });
  }

  if (errors.length > 0) return { ok: false, errors };

  const order = topologicalSort(acyclic);
  const sortedEdges = (edges: string[]) =>
    edges.map((e) => graph.getEdgeAttributes(e)).sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));

  return {
    ok: true,
    graph: {
      document,
      startNode,
      order,
      graph,
      node: (key) => graph.getNodeAttributes(key),
      executorKind: (key) => nodeCatalog[graph.getNodeAttributes(key).type].executorKind,
      outEdges: (key) => sortedEdges(graph.outEdges(key)),
      inEdges: (key) => sortedEdges(graph.inEdges(key)),
    },
  };
}
