import { z } from "zod";
import { ConditionSchema } from "../conditions/schema.ts";
import { ContextSelectorSchema, ContractSchema } from "./contracts.ts";

export const NodeTypeSchema = z.enum(["planner", "coder", "reviewer", "tester", "pr", "merge", "human_gate", "function"]);
export type NodeType = z.infer<typeof NodeTypeSchema>;

export const ExecutorKindSchema = z.enum(["cli", "shell", "github", "human", "function"]);
export type ExecutorKind = z.infer<typeof ExecutorKindSchema>;

export const LibrarySelectionSchema = z.object({
  skills: z.array(z.string()).default([]),
  mcp: z.array(z.string()).default([]),
  agents: z.array(z.string()).default([]),
  /** Library groups; each expands to its skills, MCP servers and agents when the node runs. */
  groups: z.array(z.string()).default([]),
});
export type LibrarySelection = z.infer<typeof LibrarySelectionSchema>;

/** As stored. `type` is a plain string so compileGraph can report unknown types by node. */
export const NodeAttributesSchema = z.object({
  type: z.string().min(1),
  label: z.string().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  contract: ContractSchema.optional(),
  contextSelector: ContextSelectorSchema.optional(),
  library: LibrarySelectionSchema.optional(),
  x: z.number().default(0),
  y: z.number().default(0),
});
export type NodeAttributesInput = z.input<typeof NodeAttributesSchema>;

export const EdgeAttributesSchema = z.object({
  /** The source's output port (see portsOf). It sets on and condition unless condition is given. */
  port: z.string().optional(),
  /** The target's input: in, or feedback, which loops back and carries what the source sent. */
  input: z.enum(["in", "feedback"]).optional(),
  condition: ConditionSchema.optional(),
  on: z.enum(["passed", "failed", "any"]).default("passed"),
  loop: z.boolean().default(false),
  maxAttempts: z.number().int().positive().optional(),
  onExhausted: z.string().optional(),
  priority: z.number().int().default(0),
  overrides: LibrarySelectionSchema.partial().optional(),
});
export type EdgeAttributes = z.infer<typeof EdgeAttributesSchema>;

export const GraphDocumentSchema = z.object({
  attributes: z
    .object({
      name: z.string().optional(),
      /** Empty only in a draft with no nodes yet; compileGraph refuses to run it. */
      startNode: z.string(),
      exhaustedGate: z.string().optional(),
    })
    .loose(),
  options: z
    .object({
      type: z.literal("directed").default("directed"),
      multi: z.boolean().default(false),
      allowSelfLoops: z.boolean().default(false),
    })
    .default({ type: "directed", multi: false, allowSelfLoops: false }),
  nodes: z.array(z.object({ key: z.string().min(1), attributes: NodeAttributesSchema })),
  edges: z.array(
    z.object({
      key: z.string().regex(/^[^.]+$/, "edge keys cannot contain dots"),
      source: z.string(),
      target: z.string(),
      attributes: EdgeAttributesSchema.default({ on: "passed", loop: false, priority: 0 }),
    }),
  ),
});
export type GraphDocument = z.infer<typeof GraphDocumentSchema>;
export type GraphDocumentInput = z.input<typeof GraphDocumentSchema>;
