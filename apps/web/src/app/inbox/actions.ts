"use server";

import { revalidatePath } from "next/cache";
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
