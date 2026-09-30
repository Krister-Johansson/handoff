import { z } from "zod";

export const PlannerOutputSchema = z.object({
  plan: z.string().min(1),
  steps: z.array(z.string()),
  ownedPaths: z.array(z.string()),
});

export const CoderOutputSchema = z
  .object({
    status: z.enum(["done", "failed", "needs_input"]),
    summary: z.string(),
    question: z.object({ text: z.string().min(1), options: z.array(z.string()).optional() }).optional(),
    filesChanged: z.array(z.string()).optional(),
    commitSha: z.string().optional(),
    /** Files outside the plan's owned paths that the change needed, each with the reason. */
    extraPaths: z.array(z.object({ path: z.string().min(1), reason: z.string().min(1) })).optional(),
    /** The pull request's title and description, written for a reviewer of the change. */
    pr: z.object({ title: z.string().min(1).max(256), body: z.string().min(1) }).optional(),
  })
  .refine((o) => o.status !== "needs_input" || o.question !== undefined, {
    message: "needs_input requires a question",
    path: ["question"],
  });

export const ReviewerOutputSchema = z.object({
  verdict: z.enum(["approve", "request_changes"]),
  comments: z.array(z.object({ path: z.string(), line: z.number().int().optional(), body: z.string() })),
});

export const TesterOutputSchema = z.object({
  passed: z.boolean(),
  command: z.string(),
  exitCode: z.number().int().nullable(),
  tail: z.string(),
});

export const FeedbackSchema = z.object({
  ci: z.object({
    status: z.enum(["pending", "success", "failure"]),
    failedJobs: z.array(z.object({ name: z.string(), jobId: z.number(), url: z.string(), logExcerpt: z.string() })),
  }),
  review: z.object({
    decision: z.enum(["none", "approved", "changes_requested", "commented"]),
    comments: z.array(
      z.object({
        author: z.string(),
        path: z.string().optional(),
        line: z.number().int().optional(),
        body: z.string(),
        url: z.string(),
        resolved: z.boolean(),
      }),
    ),
    unresolvedThreads: z.number().int(),
  }),
  updatedAt: z.string(),
});

export const PrOutputSchema = z.object({
  prNumber: z.number().int(),
  prUrl: z.string(),
  headSha: z.string(),
  feedback: FeedbackSchema,
});

export const MergeOutputSchema = z.object({ merged: z.boolean(), sha: z.string().optional() });

/**
 * A person's comment on what they reviewed: on a quoted part of a plan, or on lines of a file in a
 * code review. `line` to `endLine` count in the new file, or the old one when `side` is "old".
 */
export const PersonCommentSchema = z.object({
  quote: z.string().optional(),
  body: z.string(),
  path: z.string().optional(),
  line: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  side: z.enum(["old", "new"]).optional(),
});
export type PersonComment = z.infer<typeof PersonCommentSchema>;

export const HumanAnswerSchema = z.object({
  answer: z.string(),
  option: z.string().optional(),
  approved: z.boolean().optional(),
  /** The person approved on condition their comments are fixed: the gate lets the fixed work through. */
  afterFixes: z.boolean().optional(),
  /** Comments on quoted parts or lines of what the gate showed, when the person reviewed something. */
  comments: z.array(PersonCommentSchema).optional(),
  answeredBy: z.string(),
  answeredAt: z.string(),
});

export const FunctionOutputSchema = z.record(z.string(), z.unknown());

/** What a Start node hands the graph: how the run was started and the task with its linked issues. */
export const StartOutputSchema = z.object({
  trigger: z.literal("run"),
  task: z.string(),
  issues: z.array(z.object({ number: z.number().int(), title: z.string(), url: z.string() })),
});

/** A Finish node's record of the end of the run. */
export const FinishOutputSchema = z.object({ notified: z.boolean() });

export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;
export type CoderOutput = z.infer<typeof CoderOutputSchema>;
export type ReviewerOutput = z.infer<typeof ReviewerOutputSchema>;
export type TesterOutput = z.infer<typeof TesterOutputSchema>;
export type Feedback = z.infer<typeof FeedbackSchema>;
export type PrOutput = z.infer<typeof PrOutputSchema>;
export type MergeOutput = z.infer<typeof MergeOutputSchema>;
export type HumanAnswer = z.infer<typeof HumanAnswerSchema>;
