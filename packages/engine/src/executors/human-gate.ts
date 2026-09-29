import { and, eq } from "drizzle-orm";
import { questions, type Db } from "@handoff/db";
import type { ExecutorContext, ExecutorOutcome, NodeExecutor } from "../types.ts";

type Ask = { question: string; options: string[]; context: Record<string, unknown> };

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
  return {
    question: typeof config.question === "string" ? config.question : `Approve continuing after ${trigger?.from ?? "the previous step"}?`,
    options: Array.isArray(config.options) ? config.options.map(String) : ["approve", "reject"],
    context: { reason: "approval", from: trigger?.from },
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
        ...(question.option === "approve" || question.option === "reject" ? { approved: question.option === "approve" } : {}),
        answeredBy: question.answeredBy ?? "unknown",
        answeredAt: (question.answeredAt ?? new Date()).toISOString(),
      };
      const statePatch: Record<string, unknown> = { human: { ...ctx.state.human, [ctx.node.key]: answer } };
      const edgeKey = (question.context as { reason?: string; edgeKey?: string }).edgeKey;
      if ((question.context as { reason?: string }).reason === "loop_exhausted" && edgeKey && question.option !== "abort") {
        statePatch.loops = { ...ctx.state.loops, [edgeKey]: { attempts: 0 } };
      }
      return { kind: "completed", output: answer, statePatch };
    },
  };
}
