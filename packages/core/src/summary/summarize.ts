import {
  CoderOutputSchema,
  HumanAnswerSchema,
  MergeOutputSchema,
  PlannerOutputSchema,
  PrConflictOutputSchema,
  PrOutputSchema,
  ReviewerOutputSchema,
  TesterOutputSchema,
} from "../schema/outputs.ts";

const MAX = 160;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The first sentence (or line) of a text, cut to fit a one-line summary. */
function firstSentence(text: string, room: number): string {
  const line = text.trim().split("\n")[0] ?? "";
  const sentence = line.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? line;
  return sentence.length > room ? `${sentence.slice(0, room - 1)}…` : sentence;
}

const join = (lead: string, tail?: string) => {
  if (!tail) return firstSentence(lead, MAX);
  return `${firstSentence(lead, MAX - tail.length - 1)} ${tail}`.trim();
};

/** One line saying what a node produced, from its output contract; undefined for output it does not know. */
export function summarizeOutput(output: unknown): string | undefined {
  const planner = PlannerOutputSchema.safeParse(output);
  if (planner.success) {
    const { status, question, plan, steps, parts } = planner.data;
    if (status === "needs_input" && question) return join(`Asked: ${question.summary ?? question.text}`);
    if (status === "split" && parts) return `Proposed a split into ${plural(parts.length, "part")}`;
    return join(plan, plural(steps.length, "step"));
  }
  const coder = CoderOutputSchema.safeParse(output);
  if (coder.success) {
    const { status, summary, question, filesChanged, answers, answerOnly } = coder.data;
    if (status === "needs_input" && question) return join(`Asked: ${question.summary ?? question.text}`);
    if (status === "done" && answers?.length) {
      const answered = `Answered ${plural(answers.length, "review comment")}`;
      if (answerOnly) return `${answered}, no commit`;
      const verdicts = ["fixed", "declined", "unclear", "duplicate", "settled"]
        .map((v) => [v, answers.filter((a) => a.verdict === v).length] as const)
        .filter(([, n]) => n > 0)
        .map(([v, n]) => `${n} ${v}`);
      return `${answered}: ${verdicts.join(", ")}`;
    }
    return join(summary || status, filesChanged?.length ? `${plural(filesChanged.length, "file")} changed` : undefined);
  }
  const tester = TesterOutputSchema.safeParse(output);
  if (tester.success) {
    const { passed, command, exitCode } = tester.data;
    return passed ? `${command} passed` : `${command} failed, exit ${exitCode ?? "none"}`;
  }
  const reviewer = ReviewerOutputSchema.safeParse(output);
  if (reviewer.success) {
    const n = reviewer.data.comments.length;
    if (reviewer.data.verdict === "approve") return n ? `Approved with ${plural(n, "comment")}` : "Approved";
    return `Requested changes, ${plural(n, "comment")}`;
  }
  const pr = PrOutputSchema.safeParse(output);
  if (pr.success) {
    const { ci, review } = pr.data.feedback;
    const parts = [`PR #${pr.data.prNumber}`, { success: "CI passing", failure: "CI failing", pending: "CI pending" }[ci.status]];
    // Review comments sent back to the coder set the decision to changes_requested; say what GitHub decided and what went back.
    const decision = review.githubDecision ?? review.decision;
    if (decision !== "none") parts.push(decision.replace("_", " "));
    if (review.githubDecision !== undefined && review.comments.length > 0) {
      // Review items are answered one by one; plain findings are for the coder to address.
      const what = review.comments.some((c) => c.item !== undefined) ? "to answer" : "to address";
      parts.push(`${plural(review.comments.length, "review comment")} ${what}`);
    }
    return parts.join(", ");
  }
  const conflict = PrConflictOutputSchema.safeParse(output);
  if (conflict.success) {
    const { base, files } = conflict.data.conflict;
    return `Conflicts with ${base} in ${plural(files.length, "file")}: ${files.join(", ")}`;
  }
  const answer = HumanAnswerSchema.safeParse(output);
  if (answer.success) return join(`Answered: ${answer.data.option ?? answer.data.answer}`);
  const merge = MergeOutputSchema.safeParse(output);
  if (merge.success) {
    if (merge.data.needsUpdate) return "Conflicts with main, sent back to catch up";
    return merge.data.merged ? (merge.data.sha ? `Merged as ${merge.data.sha.slice(0, 7)}` : "Merged") : "Not merged";
  }
  return undefined;
}
