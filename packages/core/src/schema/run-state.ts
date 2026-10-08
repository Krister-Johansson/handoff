import { z } from "zod";
import { FeedbackSchema, HumanAnswerSchema, PlanPartSchema, PlanSizeSchema } from "./outputs.ts";

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

/** A comment on a linked issue, as a planner read it from GitHub. */
export const IssueCommentSchema = z.object({ author: z.string(), createdAt: z.string(), body: z.string() });

/**
 * A GitHub issue a run works on, with its body as it was when the run started, or when a planner last
 * read it again. `lineage` holds its parent and grandparent, nearest first; it is absent when the issue
 * has none or they could not be read. `comments` are newest first, read by a planner attempt.
 */
export const LinkedIssueSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  body: z.string(),
  lineage: z.array(IssueAncestorSchema).optional(),
  comments: z.array(IssueCommentSchema).optional(),
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

/**
 * The run this run continues, when a person ran a failed run again from its branch: its branch, where
 * this run's branch starts, and what its planner should know of it: the plan, the decisions people made
 * at its gates, and the review findings it did not get to fix.
 */
export const PreviousRunSchema = z.object({
  runId: z.string(),
  branch: z.string(),
  plan: z.object({ plan: z.string(), steps: z.array(z.string()) }).optional(),
  decisions: z
    .array(
      z.object({
        gate: z.string(),
        note: z.string().optional(),
        comments: z.array(z.object({ quote: z.string().optional(), path: z.string().optional(), line: z.number().int().optional(), endLine: z.number().int().optional(), body: z.string() })),
      }),
    )
    .default([]),
  findings: z.array(z.object({ path: z.string().optional(), line: z.number().int().optional(), body: z.string(), severity: z.string().optional(), from: z.string() })).default([]),
});
export type PreviousRun = z.infer<typeof PreviousRunSchema>;

/**
 * A run that a plan gate split: `issue` is the issue the run was started on, which it keeps building as
 * part 1, and `parts` are the issues opened for the later parts. Its pull request does not close `issue`;
 * handoff closes it once every part is closed.
 */
export const SplitOfSchema = z.object({ issue: z.number().int(), parts: z.array(z.number().int()) });
export type SplitOf = z.infer<typeof SplitOfSchema>;

export const RunStateSchema = z
  .object({
    task: z.string(),
    issues: z.array(LinkedIssueSchema).optional(),
    splitOf: SplitOfSchema.optional(),
    plan: z
      .object({ plan: z.string(), steps: z.array(z.string()), ownedPaths: z.array(z.string()), acceptance: z.array(z.string()).optional(), size: PlanSizeSchema.optional(), parts: z.array(PlanPartSchema).optional() })
      .optional(),
    prNumber: z.number().int().optional(),
    feedback: FeedbackSchema.optional(),
    loops: z.record(z.string(), z.object({ attempts: z.number().int() })).default({}),
    nodes: z.record(z.string(), NodeResultSchema).default({}),
    human: z.record(z.string(), HumanAnswerSchema).default({}),
    memory: z.record(z.string(), NodeMemorySchema).optional(),
    previousRun: PreviousRunSchema.optional(),
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
