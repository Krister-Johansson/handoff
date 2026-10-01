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
    const { status, question, plan, steps } = planner.data;
    if (status === "needs_input" && question) return join(`Asked: ${question.text}`);
    return join(plan, plural(steps.length, "step"));
  }
  const coder = CoderOutputSchema.safeParse(output);
  if (coder.success) {
    const { status, summary, question, filesChanged } = coder.data;
    if (status === "needs_input" && question) return join(`Asked: ${question.text}`);
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
    const ciText = { success: "CI passing", failure: "CI failing", pending: "CI pending" }[ci.status];
    const reviewText = review.decision === "none" ? "" : `, ${review.decision.replace("_", " ")}`;
    return `PR #${pr.data.prNumber}, ${ciText}${reviewText}`;
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
