import { z } from "zod";
import {
  CoderOutputSchema,
  FunctionOutputSchema,
  HumanAnswerSchema,
  MergeOutputSchema,
  PlannerOutputSchema,
  PrOutputSchema,
  ReviewerOutputSchema,
  TesterOutputSchema,
} from "./outputs.ts";

/** Output contracts by name. Graph JSON references these names; Zod objects never live in the graph. */
export const contractRegistry = {
  planner_output: PlannerOutputSchema,
  coder_output: CoderOutputSchema,
  reviewer_output: ReviewerOutputSchema,
  tester_output: TesterOutputSchema,
  pr_output: PrOutputSchema,
  merge_output: MergeOutputSchema,
  human_answer: HumanAnswerSchema,
  function_output: FunctionOutputSchema,
} as const satisfies Record<string, z.ZodType>;

export type ContractName = keyof typeof contractRegistry;

export function isContractName(name: string): name is ContractName {
  return Object.hasOwn(contractRegistry, name);
}

export const DeterministicCheckSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("tests_green"),
    command: z.string().min(1),
    timeoutMs: z.number().int().positive().default(600_000),
    /** Names of worker environment variables the command gets; checked by compileGraph. */
    passEnv: z.array(z.string()).optional(),
  }),
  z.object({ kind: z.literal("diff_within_paths"), paths: z.array(z.string()).optional() }),
  z.object({ kind: z.literal("pr_exists") }),
  z.object({ kind: z.literal("no_uncommitted_changes") }),
  z.object({ kind: z.literal("command"), command: z.string().min(1), expectExitCode: z.number().int().default(0), passEnv: z.array(z.string()).optional() }),
]);
export type DeterministicCheck = z.infer<typeof DeterministicCheckSchema>;

export const ContractSchema = z.object({
  output: z.string().min(1),
  checks: z.array(DeterministicCheckSchema).default([]),
});
export type Contract = z.infer<typeof ContractSchema>;

export const ContextSelectorSchema = z.object({
  stateKeys: z.array(z.string()).default([]),
  repoPaths: z.array(z.string()).default([]),
  includeFeedback: z.boolean().default(false),
  includePriorAttempt: z.boolean().default(true),
});
export type ContextSelector = z.infer<typeof ContextSelectorSchema>;
