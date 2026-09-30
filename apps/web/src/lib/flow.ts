import { GraphDocumentSchema, toReactFlow, withPorts, type FlowGraph } from "@handoff/core";

/** A stored graph as the editor and the run view draw it: with ports, including for graphs saved before ports. */
export const flowOf = (document: unknown): FlowGraph => toReactFlow(withPorts(GraphDocumentSchema.parse(document)));
