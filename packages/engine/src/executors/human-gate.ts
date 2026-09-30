import { and, eq } from "drizzle-orm";
import { questions, type Db } from "@handoff/db";
import type { ExecutorContext, ExecutorOutcome, NodeExecutor } from "../types.ts";

/** Answers the review page fills in when the person wrote no note; not decisions in themselves. */
const DEFAULT_NOTES = new Set(["Approved.", "Changes requested.", "approve", "changes"]);

type Ask = { question: string; options: string[]; context: Record<string, unknown> };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const strings = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

/** What reached the gate, as markdown a person can read and comment on, by the kind of node that sent it. */
export function reviewOf(fromType: string | undefined, output: unknown): { kind: string; markdown: string } {
  const o = obj(output);
  if (fromType === "planner" && typeof o.plan === "string") {
    const steps = strings(o.steps);
    const paths = strings(o.ownedPaths);
    return {
      kind: "plan",
      markdown: [
        o.plan.trim(),
        ...(steps.length ? ["", "## Steps", "", ...steps.map((step, i) => `${i + 1}. ${step}`)] : []),
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
  if (fromType === "coder" && typeof o.summary === "string") {
    const files = strings(o.filesChanged);
    return { kind: "change", markdown: [o.summary.trim(), ...(files.length ? ["", "## Files changed", "", ...files.map((f) => `- \`${f}\``)] : [])].join("\n") };
  }
  return { kind: "output", markdown: ["```json", JSON.stringify(output ?? null, null, 2), "```"].join("\n") };
}

/**
 * What the person reviews when a node's output reaches the gate. After a reviewer, that is the work
 * the reviewer looked at (the node feeding it), with the reviewer's verdict and comments below, so
 * the person approves the plan itself rather than the reviewer's opinion of it.
 */
function reviewFor(ctx: ExecutorContext, from: string): { from: string; kind: string; markdown: string } {
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

function compose(ctx: ExecutorContext): Ask {
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
  const review = trigger?.from ? reviewFor(ctx, trigger.from) : undefined;
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
export function humanGateExecutor(deps: { db: Db }): NodeExecutor {
  return {
    needsWorkdir: false,
    async execute(ctx): Promise<ExecutorOutcome> {
      let [question] = await deps.db.select().from(questions).where(eq(questions.nodeExecutionId, ctx.execution.id));
      if (!question) {
        const ask = compose(ctx);
        [question] = await deps.db
          .insert(questions)
          .values({ runId: ctx.run.id, nodeExecutionId: ctx.execution.id, ...ask })
          .onConflictDoNothing()
          .returning();
        question ??= (await deps.db.select().from(questions).where(and(eq(questions.nodeExecutionId, ctx.execution.id))))[0]!;
        ctx.emit("human.asked", { questionId: question.id, question: question.question, options: question.options });
      }
      if (question.answer === null) return { kind: "waiting", wait: { kind: "human", token: question.id } };

      const answer = {
        answer: question.answer,
        ...(question.option ? { option: question.option } : {}),
        ...(question.option === "approve" || question.option === "reject" || question.option === "changes" ? { approved: question.option === "approve" } : {}),
        ...(question.comments.length ? { comments: question.comments } : {}),
        answeredBy: question.answeredBy ?? "unknown",
        answeredAt: (question.answeredAt ?? new Date()).toISOString(),
      };
      const statePatch: Record<string, unknown> = { human: { ...ctx.state.human, [ctx.node.key]: answer } };
      // A review that asks for changes, comments, or has a note of its own is a decision every later step must keep to.
      const note = DEFAULT_NOTES.has(question.answer.trim()) ? undefined : question.answer;
      const decided = question.option === "changes" || question.option === "reject" || question.comments.length > 0 || note !== undefined;
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
