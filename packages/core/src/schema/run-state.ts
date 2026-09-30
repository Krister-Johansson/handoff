import { z } from "zod";
import { FeedbackSchema, HumanAnswerSchema } from "./outputs.ts";

export const NodeResultSchema = z.object({
  output: z.unknown().optional(),
  executionId: z.string(),
  attempt: z.number().int(),
  sessionId: z.string().optional(),
  lastFailure: z.object({ checks: z.array(z.unknown()), error: z.unknown() }).optional(),
});

/** A GitHub issue a run works on, with its body as it was when the run started. */
export const LinkedIssueSchema = z.object({ number: z.number().int(), title: z.string(), url: z.string(), body: z.string() });
export type LinkedIssue = z.infer<typeof LinkedIssueSchema>;

export const RunStateSchema = z
  .object({
    task: z.string(),
    issues: z.array(LinkedIssueSchema).optional(),
    plan: z.object({ plan: z.string(), steps: z.array(z.string()), ownedPaths: z.array(z.string()) }).optional(),
    prNumber: z.number().int().optional(),
    feedback: FeedbackSchema.optional(),
    loops: z.record(z.string(), z.object({ attempts: z.number().int() })).default({}),
    nodes: z.record(z.string(), NodeResultSchema).default({}),
    human: z.record(z.string(), HumanAnswerSchema).default({}),
  })
  .loose();

export type RunState = z.infer<typeof RunStateSchema>;
export type NodeResult = z.infer<typeof NodeResultSchema>;

export function initialRunState(task: string, issues: LinkedIssue[] = []): RunState {
  return { task, ...(issues.length ? { issues } : {}), loops: {}, nodes: {}, human: {} };
}

/** Shallow-merges a node's state patch and records its result under nodes[key]. */
export function mergeState(state: RunState, nodeKey: string, result: NodeResult, patch: Record<string, unknown> = {}): RunState {
  return { ...state, ...patch, nodes: { ...state.nodes, [nodeKey]: result } };
}
