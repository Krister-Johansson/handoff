import { and, eq } from "drizzle-orm";
import { limitDiff, notifies, type DiffFile } from "@handoff/core";
import { questions, type Db } from "@handoff/db";
import type { ExecutorContext, ExecutorOutcome, NodeExecutor } from "../types.ts";

/** Answers the review page fills in when the person wrote no note; not decisions in themselves. */
const DEFAULT_NOTES = new Set(["Approved.", "Changes requested.", "approve", "changes"]);

type Ask = { question: string; options: string[]; context: Record<string, unknown> };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const strings = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

/** Terminal colour and cursor codes, which test runners print and a web page shows as noise. */
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
export const stripAnsi = (text: string) => text.replace(ANSI, "");

/** Nodes whose work is the branch itself, so a gate after them reviews the code. */
const CODE_SENDERS = new Set(["coder", "tester", "code_review", "pr"]);

/** Reads what the run's branch changed against its base, as the files a person reviews. */
export type BranchDiff = (run: ExecutorContext["run"]) => Promise<DiffFile[] | undefined>;

/** What reached the gate, as markdown a person can read and comment on, by the kind of node that sent it. */
export function reviewOf(fromType: string | undefined, output: unknown): { kind: string; markdown: string } {
  const o = obj(output);
  if (fromType === "planner" && typeof o.plan === "string") {
    const steps = strings(o.steps);
    const paths = strings(o.ownedPaths);
    const acceptance = strings(o.acceptance);
    return {
      kind: "plan",
      markdown: [
        o.plan.trim(),
        ...(steps.length ? ["", "## Steps", "", ...steps.map((step, i) => `${i + 1}. ${step}`)] : []),
        ...(acceptance.length ? ["", "## Acceptance criteria", "", ...acceptance.map((item) => `- ${item}`)] : []),
        ...(paths.length ? ["", "## Files it will change", "", ...paths.map((p) => `- \`${p}\``)] : []),
      ].join("\n"),
    };
  }
  if ((fromType === "reviewer" || fromType === "code_review") && typeof o.verdict === "string") {
    const comments = Array.isArray(o.comments) ? o.comments.map(obj) : [];
    return {
      kind: "review",
      markdown: [`Verdict: **${o.verdict === "approve" ? "approve" : "request changes"}**`, "", ...comments.map((c) => `- ${c.path ? `\`${String(c.path)}${c.line ? `:${String(c.line)}` : ""}\` ` : ""}${String(c.body ?? "")}`)].join("\n"),
    };
  }
  if (fromType === "tester" && typeof o.passed === "boolean") {
    const tail = stripAnsi(String(o.tail ?? "")).trim();
    return {
      kind: "output",
      markdown: [`Tests **${o.passed ? "passed" : "failed"}**: \`${String(o.command ?? "")}\` exited ${String(o.exitCode)}.`, ...(tail ? ["", "```text", tail, "```"] : [])].join("\n"),
    };
  }
  if (fromType === "coder" && typeof o.summary === "string") {
    const files = strings(o.filesChanged);
    const extra = (Array.isArray(o.extraPaths) ? o.extraPaths.map(obj) : []).map((e) => `- \`${String(e.path)}\`: ${String(e.reason ?? "")}`);
    return {
      kind: "change",
      markdown: [
        o.summary.trim(),
        ...(extra.length ? ["", "## Files outside the plan", "", ...extra] : []),
        ...(files.length ? ["", "## Files changed", "", ...files.map((f) => `- \`${f}\``)] : []),
      ].join("\n"),
    };
  }
  return { kind: "output", markdown: ["```json", JSON.stringify(output ?? null, null, 2), "```"].join("\n") };
}

/**
 * What the person reviews when a node's output reaches the gate. After a reviewer, that is the work
 * the reviewer looked at (the node feeding it), with the reviewer's verdict and comments below, so
 * the person approves the plan itself rather than the reviewer's opinion of it.
 */
type Review = { from: string; kind: string; markdown: string; files?: DiffFile[]; backTo?: string };

function reviewFor(ctx: ExecutorContext, from: string): Review {
  const sender = ctx.graph.node(from);
  const output = ctx.state.nodes[from]?.output;
  if (sender?.type === "reviewer") {
    const reviewed = ctx.graph.inEdges(from).find((e) => !e.loop)?.source;
    const work = reviewed ? ctx.state.nodes[reviewed]?.output : undefined;
    if (reviewed && work !== undefined) {
      const main = reviewOf(ctx.graph.node(reviewed)?.type, work);
      const verdict = reviewOf("reviewer", output);
      return { from: reviewed, kind: main.kind, markdown: `${main.markdown}\n\n## Review by ${from}\n\n${verdict.markdown}` };
    }
  }
  return { from, ...reviewOf(sender?.type, output) };
}

/** After a node that works on the branch, the review is the code: the sender's summary and the diff. */
async function withCode(ctx: ExecutorContext, review: Review, branchDiff: BranchDiff | undefined): Promise<Review> {
  if (!branchDiff || !CODE_SENDERS.has(ctx.graph.node(review.from)?.type ?? "")) return review;
  const files = limitDiff((await branchDiff(ctx.run).catch(() => undefined)) ?? []);
  return files.length ? { ...review, kind: "code", files } : review;
}

async function compose(ctx: ExecutorContext, branchDiff: BranchDiff | undefined): Promise<Ask> {
  const trigger = ctx.execution.trigger;
  if (trigger?.kind === "exhausted") {
    const attempts = ctx.state.loops[trigger.edgeKey ?? ""]?.attempts ?? 0;
    return {
      question: `The loop ${trigger.edgeKey} used all ${attempts} attempts. Retry with another round, or abort the run?`,
      options: ["retry", "abort"],
      context: { reason: "loop_exhausted", edgeKey: trigger.edgeKey, from: trigger.from },
    };
  }
  const from = trigger?.from ? ctx.state.nodes[trigger.from]?.output : undefined;
  const asked = (from as { question?: { text?: string; options?: string[] } } | undefined)?.question;
  if (asked?.text) return { question: asked.text, options: asked.options ?? [], context: { reason: "needs_input", from: trigger?.from } };
  const config = ctx.node.config;
  // Review mode: show what arrived, so the person can read it, comment and approve or ask for changes.
  const found = trigger?.from ? await withCode(ctx, reviewFor(ctx, trigger.from), branchDiff) : undefined;
  // Where the person's comments go when they ask for changes, which is not always the node that sent the work.
  const backTo = ctx.graph.outEdges(ctx.node.key).find((e) => e.port === "changes")?.target;
  const review = found && backTo ? { ...found, backTo } : found;
  return {
    question: typeof config.question === "string" ? config.question : review ? `Review the ${review.kind} from ${review.from}` : "Approve continuing?",
    options: Array.isArray(config.options) ? config.options.map(String) : ["approve", "changes"],
    context: { reason: "approval", from: trigger?.from, ...(review ? { review } : {}) },
  };
}

/**
 * Asks a person. The first run stores a question and waits on its id; answering wakes the gate,
 * which records the answer in run state. Retrying an exhausted loop resets that loop's counter.
 */
export function humanGateExecutor(deps: { db: Db; branchDiff?: BranchDiff }): NodeExecutor {
  return {
    needsWorkdir: false,
    async execute(ctx): Promise<ExecutorOutcome> {
      let [question] = await deps.db.select().from(questions).where(eq(questions.nodeExecutionId, ctx.execution.id));
      const approvedAfterFixes = obj(ctx.state.approvedAfterFixes);
      const preApproved = approvedAfterFixes[ctx.node.key];
      if (!question && preApproved && ctx.execution.trigger?.kind !== "exhausted") {
        // The person approved this gate once their comments were fixed: the fixed work goes on without a new question.
        const by = String(obj(preApproved).answeredBy ?? "unknown");
        const { [ctx.node.key]: _used, ...rest } = approvedAfterFixes;
        ctx.emit("human.auto_approved", { approvedBy: by });
        const answer = { answer: "Approved after fixes.", option: "approve", approved: true, answeredBy: by, answeredAt: new Date().toISOString() };
        return { kind: "completed", output: answer, statePatch: { human: { ...ctx.state.human, [ctx.node.key]: answer }, approvedAfterFixes: rest } };
      }
      if (!question) {
        const ask = await compose(ctx, deps.branchDiff);
        [question] = await deps.db
          .insert(questions)
          .values({ runId: ctx.run.id, nodeExecutionId: ctx.execution.id, ...ask })
          .onConflictDoNothing()
          .returning();
        question ??= (await deps.db.select().from(questions).where(and(eq(questions.nodeExecutionId, ctx.execution.id))))[0]!;
        ctx.emit("human.asked", { questionId: question.id, question: question.question, options: question.options });
        if (notifies(ctx.node, "input")) ctx.emit("notify", { kind: "input", nodeKey: ctx.node.key, questionId: question.id });
      }
      if (question.answer === null) return { kind: "waiting", wait: { kind: "human", token: question.id } };

      // "Approve after fixes" routes like changes; the gate remembers to let the fixed work through.
      const afterFixes = question.option === "fix";
      const option = afterFixes ? "changes" : question.option;
      const answer = {
        answer: question.answer,
        ...(option ? { option } : {}),
        ...(option === "approve" || option === "reject" || option === "changes" ? { approved: option === "approve" } : {}),
        ...(afterFixes ? { afterFixes: true } : {}),
        ...(question.comments.length ? { comments: question.comments } : {}),
        answeredBy: question.answeredBy ?? "unknown",
        answeredAt: (question.answeredAt ?? new Date()).toISOString(),
      };
      const statePatch: Record<string, unknown> = { human: { ...ctx.state.human, [ctx.node.key]: answer } };
      if (afterFixes) statePatch.approvedAfterFixes = { ...approvedAfterFixes, [ctx.node.key]: { answeredBy: answer.answeredBy } };
      // A review that asks for changes, comments, or has a note of its own is a decision every later step must keep to.
      const note = DEFAULT_NOTES.has(question.answer.trim()) ? undefined : question.answer;
      const decided = option === "changes" || option === "reject" || question.comments.length > 0 || note !== undefined;
      if ((question.context as { reason?: string }).reason === "approval" && decided) {
        const previous = Array.isArray(ctx.state.decisions) ? ctx.state.decisions : [];
        statePatch.decisions = [...previous, { gate: ctx.node.key, ...(note ? { note } : {}), comments: question.comments }];
      }
      const edgeKey = (question.context as { reason?: string; edgeKey?: string }).edgeKey;
      if ((question.context as { reason?: string }).reason === "loop_exhausted" && edgeKey && question.option !== "abort") {
        statePatch.loops = { ...ctx.state.loops, [edgeKey]: { attempts: 0 } };
      }
      return { kind: "completed", output: answer, statePatch };
    },
  };
}
