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
  | "unknown_contract";

export type CompileError = { code: CompileErrorCode; message: string; nodeKey?: string; edgeKey?: string };

export type CompiledNode = {
  key: string;
  type: NodeType;
  label: string;
  config: Record<string, unknown>;
  contract: Contract;
  contextSelector: ContextSelector;
  library: { skills: string[]; mcp: string[] };
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

export function compileGraph(input: unknown): CompileResult {
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
    graph.addNode(key, {
      key,
      type: attributes.type,
      label: attributes.label ?? key,
      config: attributes.config,
      contract,
      contextSelector: attributes.contextSelector ?? ContextSelectorSchema.parse({}),
      library: { skills: attributes.library?.skills ?? [], mcp: attributes.library?.mcp ?? [] },
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
