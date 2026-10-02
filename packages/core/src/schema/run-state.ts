import { z } from "zod";
import { FeedbackSchema, HumanAnswerSchema, PlanSizeSchema } from "./outputs.ts";

export const NodeResultSchema = z.object({
  output: z.unknown().optional(),
  executionId: z.string(),
  attempt: z.number().int(),
  sessionId: z.string().optional(),
  lastFailure: z.object({ checks: z.array(z.unknown()), error: z.unknown() }).optional(),
});

/** A parent of a linked issue: a story or an epic it is part of. */
export const IssueAncestorSchema = z.object({ kind: z.enum(["epic", "story", "task"]).optional(), number: z.number().int(), title: z.string(), body: z.string() });
export type IssueAncestor = z.infer<typeof IssueAncestorSchema>;

/**
 * A GitHub issue a run works on, with its body as it was when the run started. `lineage` holds its
 * parent and grandparent, nearest first; it is absent when the issue has none or they could not be read.
 */
export const LinkedIssueSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  body: z.string(),
  lineage: z.array(IssueAncestorSchema).optional(),
});
export type LinkedIssue = z.infer<typeof LinkedIssueSchema>;

/**
 * What earlier attempts of one node were told in this run, so every later attempt is told it too: the
 * files outside the plan it declared, the operator's repair notes, and a person's answers to its questions.
 */
export const NodeMemorySchema = z.object({
  /** `by: "person"` marks a path a person allowed when the path check asked; the others an attempt declared. */
  extraPaths: z.array(z.object({ path: z.string(), reason: z.string(), attempt: z.number().int(), by: z.literal("person").optional() })).default([]),
  notes: z.array(z.object({ note: z.string(), attempt: z.number().int() })).default([]),
  answers: z
    .array(z.object({ question: z.string(), answer: z.string(), option: z.string().optional(), answeredBy: z.string().optional(), attempt: z.number().int().optional() }))
    .default([]),
});
export type NodeMemory = z.infer<typeof NodeMemorySchema>;

export const RunStateSchema = z
  .object({
    task: z.string(),
    issues: z.array(LinkedIssueSchema).optional(),
    plan: z.object({ plan: z.string(), steps: z.array(z.string()), ownedPaths: z.array(z.string()), acceptance: z.array(z.string()).optional(), size: PlanSizeSchema.optional() }).optional(),
    prNumber: z.number().int().optional(),
    feedback: FeedbackSchema.optional(),
    loops: z.record(z.string(), z.object({ attempts: z.number().int() })).default({}),
    nodes: z.record(z.string(), NodeResultSchema).default({}),
    human: z.record(z.string(), HumanAnswerSchema).default({}),
    memory: z.record(z.string(), NodeMemorySchema).optional(),
  })
  .loose();

export type RunState = z.infer<typeof RunStateSchema>;
export type NodeResult = z.infer<typeof NodeResultSchema>;

export function initialRunState(task: string, issues: LinkedIssue[] = []): RunState {
  return { task, ...(issues.length ? { issues } : {}), loops: {}, nodes: {}, human: {} };
}

/** A node's memory in the run, empty when nothing was recorded for it yet. */
export function memoryOf(state: RunState, nodeKey: string): NodeMemory {
  return NodeMemorySchema.parse(state.memory?.[nodeKey] ?? {});
}

/** Appends to a node's memory. A path already remembered keeps its first reason. */
export function remember(state: RunState, nodeKey: string, add: Partial<NodeMemory>): RunState {
  const current = memoryOf(state, nodeKey);
  const known = new Set(current.extraPaths.map((e) => e.path));
  const extraPaths = [...current.extraPaths];
  for (const entry of add.extraPaths ?? []) {
    if (known.has(entry.path)) continue;
    known.add(entry.path);
    extraPaths.push(entry);
  }
  const next: NodeMemory = { extraPaths, notes: [...current.notes, ...(add.notes ?? [])], answers: [...current.answers, ...(add.answers ?? [])] };
  return { ...state, memory: { ...state.memory, [nodeKey]: next } };
}

/** Shallow-merges a node's state patch and records its result under nodes[key]. */
export function mergeState(state: RunState, nodeKey: string, result: NodeResult, patch: Record<string, unknown> = {}): RunState {
  return { ...state, ...patch, nodes: { ...state.nodes, [nodeKey]: result } };
}
