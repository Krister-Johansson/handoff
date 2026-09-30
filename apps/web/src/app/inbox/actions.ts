"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { answerQuestion, cancelRun, repairNodeExecution } from "@handoff/engine/operations";
import { getDb } from "@/lib/db";

export type InboxActionState = { ok?: boolean; error?: string };

const field = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

function refresh(runId: string) {
  revalidatePath("/inbox");
  if (runId) revalidatePath(`/runs/${runId}`);
}

export async function answerAction(_: InboxActionState, form: FormData): Promise<InboxActionState> {
  const option = field(form, "option");
  const text = field(form, "answer");
  const answer = text || option;
  if (!answer) return { ok: false, error: "Pick an option or write an answer." };
  try {
    await answerQuestion(getDb(), field(form, "questionId"), { answer, answeredBy: "dashboard", ...(option ? { option } : {}) });
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  refresh(field(form, "runId"));
  return { ok: true };
}

export async function repairAction(_: InboxActionState, form: FormData): Promise<InboxActionState> {
  try {
    const note = field(form, "note");
    await repairNodeExecution(getDb(), field(form, "executionId"), note ? { note } : {});
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  refresh(field(form, "runId"));
  return { ok: true };
}

export async function cancelAction(_: InboxActionState, form: FormData): Promise<InboxActionState> {
  try {
    await cancelRun(getDb(), field(form, "runId"), { reason: "cancelled from the dashboard" });
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  refresh(field(form, "runId"));
  return { ok: true };
}

const ReviewAnswerSchema = z.object({
  questionId: z.string().uuid(),
  runId: z.string().uuid(),
  option: z.enum(["approve", "changes", "fix"]),
  note: z.string().max(10_000),
  comments: z
    .array(
      z.object({
        quote: z.string().max(20_000),
        body: z.string().min(1).max(10_000),
        path: z.string().max(1_000).optional(),
        line: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
        side: z.enum(["old", "new"]).optional(),
      }),
    )
    .max(200),
});

/** Answers a human gate's review: approve, or changes with comments on quoted passages or lines of files. Returns to the run. */
export async function answerReviewAction(input: z.input<typeof ReviewAnswerSchema>): Promise<InboxActionState> {
  const parsed = ReviewAnswerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That review cannot be sent." };
  const { questionId, runId, option, note, comments } = parsed.data;
  if (option !== "approve" && !note && comments.length === 0) return { ok: false, error: "Say what to change: add a comment or a note." };
  try {
    await answerQuestion(getDb(), questionId, { answer: note || (option === "approve" ? "Approved." : "Changes requested."), option, comments, answeredBy: "dashboard" });
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  refresh(runId);
  redirect(`/runs/${runId}`);
}
