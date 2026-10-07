import { z } from "zod";

/** What a node asks a person: the full question, and one line that says what is asked, for notifications. */
const QuestionSchema = z.object({
  text: z.string().min(1),
  summary: z.string().min(1).optional().describe("The decision asked for, in one line of at most 80 characters. Notifications show it."),
  options: z.array(z.string()).optional(),
});

/** A task's size, the same S, M and L as the plan's Size field. */
export const PlanSizeSchema = z.enum(["S", "M", "L"]);

/** One part of a task a planner proposes to split: what it builds, and the files it owns. */
export const PlanPartSchema = z.object({
  title: z.string().min(1).max(256),
  body: z.string().min(1).describe("What this part builds and how a person checks it is done, as an issue body."),
  ownedPaths: z.array(z.string()).min(1),
});
export type PlanPart = z.infer<typeof PlanPartSchema>;

/**
 * A plan, a question when the task leaves a decision to a person, or a split into parts when the task
 * is over the plan budget. Outputs from before planners could ask have no status and are plans.
 */
export const PlannerOutputSchema = z
  .object({
    status: z.enum(["done", "needs_input", "split"]).optional(),
    plan: z.string(),
    steps: z.array(z.string()),
    ownedPaths: z.array(z.string()),
    /** What a person can check in the running app to see the task is done, when the issue lists none. */
    acceptance: z.array(z.string().min(1)).optional(),
    /** The planner's proposal for the task's Size; the plan's timeline shows it until a person picks a size. */
    size: PlanSizeSchema.optional().describe("S for a change in one place, M for a feature across a few files, L for a change across several areas."),
    question: QuestionSchema.optional(),
    /** With status split: the parts in the order to build them. The first stays in this run; each later one becomes an issue. */
    parts: z.array(PlanPartSchema).optional(),
  })
  .refine((o) => (o.status === "needs_input" ? o.question !== undefined : o.status === "split" ? (o.parts?.length ?? 0) >= 2 : o.plan.trim().length > 0), {
    message: "a plan needs text, needs_input needs a question, and split needs at least two parts",
    path: ["plan"],
  });

/**
 * The coder's answer to one review comment, after it checked the comment's claim. The contract check
 * review_items_answered enforces what each verdict needs: a commit made in the round for fixed (or, for
 * a summary note or pre-merge check, evidence of what changed), and evidence for declined, unclear and duplicate.
 */
export const ReviewAnswerSchema = z.object({
  id: z.string().min(1).describe("The comment's handle, such as R3."),
  verdict: z
    .enum(["fixed", "declined", "unclear", "duplicate", "settled"])
    .describe(
      "fixed: the claim holds and you fixed it. declined: the claim does not hold and you changed nothing for it. unclear: you cannot tell what is meant. duplicate: it repeats another listed comment. settled: the reviewer's reply accepts the earlier answer.",
    ),
  evidence: z.string().describe("What you checked and what it showed: the command and its output, the file and lines, or the test."),
  commit: z
    .string()
    .min(1)
    .optional()
    .describe("With fixed: the commit that fixes it. A summary note or pre-merge check fixed through the pull request's title or description has none; the evidence says what changed."),
  of: z.string().min(1).optional().describe("With duplicate: the handle of the comment it repeats, such as R2."),
});
export type ReviewAnswer = z.infer<typeof ReviewAnswerSchema>;

export const CoderOutputSchema = z
  .object({
    status: z.enum(["done", "failed", "needs_input"]),
    summary: z.string(),
    question: QuestionSchema.optional(),
    filesChanged: z.array(z.string()).optional(),
    commitSha: z.string().optional(),
    /** Files outside the plan's owned paths that the change needed, each with the reason. */
    extraPaths: z.array(z.object({ path: z.string().min(1), reason: z.string().min(1) })).optional(),
    /** The pull request's title and description, written for a reviewer of the change. */
    pr: z.object({ title: z.string().min(1).max(256), body: z.string().min(1) }).optional(),
    /** One answer per review comment listed under Review comments to answer. */
    answers: z.array(ReviewAnswerSchema).optional(),
    /** Set by handoff, never the agent: every answer changes nothing, and the branch and the worktree are as the pull request step left them. */
    answerOnly: z.literal(true).optional(),
  })
  .refine((o) => o.status !== "needs_input" || o.question !== undefined, {
    message: "needs_input requires a question",
    path: ["question"],
  });

/** The files outside the plan an output declared, each with its reason, as a coder's output lists them. */
export function extraPathsOf(output: unknown): { path: string; reason: string }[] {
  const extra = (output as { extraPaths?: unknown } | undefined)?.extraPaths;
  if (!Array.isArray(extra)) return [];
  return extra.flatMap((e) => {
    const { path, reason } = (e ?? {}) as { path?: unknown; reason?: unknown };
    return typeof path === "string" ? [{ path, reason: typeof reason === "string" ? reason : "" }] : [];
  });
}

/**
 * How much a review finding matters: blocking sends the work back, should_fix is worth doing in this
 * change, follow_up can wait for another issue. Findings from before severities read as should_fix.
 */
export const FindingSeveritySchema = z.enum(["blocking", "should_fix", "follow_up"]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const ReviewerOutputSchema = z.object({
  verdict: z.enum(["approve", "request_changes"]),
  comments: z.array(
    z.object({
      path: z.string(),
      line: z.number().int().optional(),
      body: z.string(),
      severity: FindingSeveritySchema.default("should_fix").describe(
        "blocking: a defect a user can hit on the main path of the change, a security hole, a broken accessibility requirement the project states, or a failing acceptance criterion. should_fix: worth fixing in this change. follow_up: can wait for another issue.",
      ),
    }),
  ),
});

/** The verdict a review's findings call for, whatever the reviewer wrote: request_changes with any blocking finding, approve otherwise. */
export const verdictOf = (comments: readonly { severity: FindingSeverity }[]): "approve" | "request_changes" =>
  comments.some((c) => c.severity === "blocking") ? "request_changes" : "approve";

export const TesterOutputSchema = z.object({
  passed: z.boolean(),
  command: z.string(),
  exitCode: z.number().int().nullable(),
  tail: z.string(),
  /** Set when the command passed only on a retry: how the earlier run failed. */
  note: z.string().optional(),
});

/** A browser console message the demo agent read: an error, such as an unhandled rejection, or a warning. */
export const ConsoleEntrySchema = z.object({ level: z.enum(["error", "warning"]), text: z.string().min(1) });

/** A warning or error from the browser console or the app's server log, as the Try it gate shows it. */
export const DemoWarningSchema = z.object({
  source: z.enum(["console", "server"]),
  level: z.enum(["error", "warning"]),
  text: z.string(),
  /** Not seen in the project's previous demo. */
  new: z.boolean(),
});
export type DemoWarning = z.infer<typeof DemoWarningSchema>;

/**
 * A Demo node's walk through the running app: screenshots, each with a caption and, when it shows an
 * acceptance criterion, whether that criterion works. `file` is the screenshot's name in the browser's
 * output folder; the engine stores the file and adds `artifactId`.
 */
export const DemoOutputSchema = z.object({
  summary: z.string(),
  shots: z.array(
    z.object({
      file: z.string().min(1),
      caption: z.string().min(1),
      criterion: z.string().optional(),
      works: z.boolean(),
      artifactId: z.string().optional(),
    }),
  ),
  /** The browser console's errors and warnings while the agent walked through the app. An error fails the demo. */
  console: z.array(ConsoleEntrySchema).default([]),
  /** Set by handoff: the warnings and errors of the console and the app's server log, each marked new when the project's previous demo did not have it. */
  warnings: z.array(DemoWarningSchema).optional(),
  /** Set by handoff, never the agent: the demo did not run, since the change touches no UI path. */
  skipped: z.literal(true).optional(),
  /** Why the demo was skipped. */
  reason: z.string().optional(),
});
export type DemoOutput = z.infer<typeof DemoOutputSchema>;

export const FeedbackSchema = z.object({
  ci: z.object({
    status: z.enum(["pending", "success", "failure"]),
    failedJobs: z.array(z.object({ name: z.string(), jobId: z.number(), url: z.string(), logExcerpt: z.string() })),
  }),
  review: z.object({
    decision: z.enum(["none", "approved", "changes_requested", "commented"]),
    /**
     * GitHub's review decision, recorded when the PR node sends review comments back to the coder. It
     * then sets `decision` to changes_requested so the graph's fix edge takes them, whatever GitHub says.
     */
    githubDecision: z.enum(["none", "approved", "changes_requested", "commented"]).optional(),
    comments: z.array(
      z.object({
        author: z.string(),
        path: z.string().optional(),
        line: z.number().int().optional(),
        body: z.string(),
        url: z.string(),
        resolved: z.boolean(),
        /** The review item's handle, such as R3, when the PR node manages the comment's answer. */
        item: z.string().optional(),
        kind: z.enum(["thread", "review_body", "summary_note", "pre_merge_check"]).optional(),
        /** The thread after its first comment, oldest first, when the item came back with a reply. */
        conversation: z.array(z.object({ author: z.string(), body: z.string() })).optional(),
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

/** The PR node found that the base branch changed the same lines as the run, before pushing. */
export const PrConflictOutputSchema = z.object({
  sync: z.literal("conflict"),
  conflict: z.object({ base: z.string(), baseSha: z.string(), files: z.array(z.string()) }),
});

/** What the PR node returns: the pull request's state, or a conflict with the base branch. */
export const PrNodeOutputSchema = z.union([PrOutputSchema.extend({ sync: z.literal("clean").optional() }), PrConflictOutputSchema]);

/** `needsUpdate` when GitHub refused the merge because the branch conflicts with the base branch. */
export const MergeOutputSchema = z.object({ merged: z.boolean(), sha: z.string().optional(), needsUpdate: z.boolean().optional() });

/**
 * A person's comment on what they reviewed: on a quoted part of a plan, or on lines of a file in a
 * code review. `line` to `endLine` count in the new file, or the old one when `side` is "old".
 * `author` names the code reviewing step when the comment is one of its findings the person sent back.
 */
export const PersonCommentSchema = z.object({
  quote: z.string().optional(),
  body: z.string(),
  path: z.string().optional(),
  line: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  side: z.enum(["old", "new"]).optional(),
  author: z.string().optional(),
});
export type PersonComment = z.infer<typeof PersonCommentSchema>;

export const HumanAnswerSchema = z.object({
  answer: z.string(),
  option: z.string().optional(),
  approved: z.boolean().optional(),
  /** The person approved on condition their comments are fixed: the gate lets the fixed work through. */
  afterFixes: z.boolean().optional(),
  /** The person accepted the planner's split: the run now builds the first part, and it routes like changes, back to plan it. */
  split: z.boolean().optional(),
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
export type PrConflictOutput = z.infer<typeof PrConflictOutputSchema>;
export type HumanAnswer = z.infer<typeof HumanAnswerSchema>;
