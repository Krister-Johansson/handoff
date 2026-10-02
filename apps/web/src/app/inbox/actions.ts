"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { answerQuestion, cancelRun, decidePermission, repairNodeExecution, resolveExhaustedLoop, restartTryIt } from "@handoff/engine/operations";
import { allowPathsOf } from "@/lib/allow-paths";
import { getDb } from "@/lib/db";
import { getProjects } from "@/lib/github";
import { runPathOf } from "@/server/run-path";
import { markViewed } from "@/server/review";
import { allowToolForNode } from "@/server/allow-tool";
import { permissionExecution } from "@/server/permissions";

export type InboxActionState = { ok?: boolean; error?: string };

const field = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

function refresh(runId: string) {
  revalidatePath("/inbox");
  // Run pages sit under their project; revalidate the route rather than look the project up.
  if (runId) revalidatePath("/projects/[projectId]/runs/[runId]", "page");
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
    const allowPaths = allowPathsOf(field(form, "allowPaths"));
    await repairNodeExecution(getDb(), field(form, "executionId"), { ...(note ? { note } : {}), ...(allowPaths.length ? { allowPaths } : {}) });
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  refresh(field(form, "runId"));
  return { ok: true };
}

export async function cancelAction(_: InboxActionState, form: FormData): Promise<InboxActionState> {
  try {
    await cancelRun(getDb(), field(form, "runId"), { reason: "cancelled from the dashboard", projects: getProjects() });
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
  redirect((await runPathOf(getDb(), runId)) ?? "/inbox");
}

const ViewedSchema = z.object({ runId: z.string().uuid(), path: z.string().min(1).max(1_000), blobSha: z.string().min(1).max(100), viewed: z.boolean() });

/** Marks a version of a file viewed, or not, in a run's code review. */
export async function markViewedAction(input: z.input<typeof ViewedSchema>): Promise<InboxActionState> {
  const parsed = ViewedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That file cannot be marked." };
  await markViewed(getDb(), parsed.data);
  return { ok: true };
}

const ResolveLoopSchema = z.object({ runId: z.string().uuid(), action: z.enum(["retry", "continue", "stop"]) });

/** A person's decision for a run stuck on a loop that ran out: another round, go on as if approved, or stop. */
export async function resolveLoopAction(input: z.input<typeof ResolveLoopSchema>): Promise<InboxActionState> {
  const parsed = ResolveLoopSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That decision cannot be sent." };
  try {
    await resolveExhaustedLoop(getDb(), parsed.data.runId, parsed.data.action, { projects: getProjects() });
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  refresh(parsed.data.runId);
  return { ok: true };
}

const RestartSchema = z.object({ questionId: z.string().uuid(), runId: z.string().uuid() });

/** Starts a Try it gate's app again, when it stopped or did not start. */
export async function restartTryItAction(input: z.input<typeof RestartSchema>): Promise<InboxActionState> {
  const parsed = RestartSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That app cannot be restarted." };
  try {
    await restartTryIt(getDb(), parsed.data.questionId);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  refresh(parsed.data.runId);
  return { ok: true };
}

const PermissionAnswerSchema = z.discriminatedUnion("decision", [
  z.object({ id: z.string().uuid(), runId: z.string().uuid(), decision: z.literal("once") }),
  z.object({ id: z.string().uuid(), runId: z.string().uuid(), decision: z.literal("always"), rule: z.string().min(1).max(500) }),
  z.object({ id: z.string().uuid(), runId: z.string().uuid(), decision: z.literal("deny"), message: z.string().max(2_000).optional() }),
]);

/**
 * Answers a step's permission request. Always allow records the rule on the request, so the node's
 * matching calls and later attempts in this run do not ask, and adds it to the node in the graph's next
 * version, so later runs do not ask.
 */
export async function answerPermissionAction(input: z.input<typeof PermissionAnswerSchema>): Promise<InboxActionState> {
  const parsed = PermissionAnswerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That answer cannot be sent." };
  const answer = parsed.data;
  try {
    if (answer.decision === "always") {
      const executionId = await permissionExecution(getDb(), answer.id);
      await allowToolForNode(getDb(), { runId: answer.runId, executionId, rule: answer.rule });
    }
    await decidePermission(getDb(), answer.id, {
      allow: answer.decision !== "deny",
      decidedBy: "dashboard",
      ...(answer.decision === "always" ? { rule: answer.rule } : {}),
      ...(answer.decision === "deny" && answer.message ? { message: answer.message } : {}),
    });
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  refresh(answer.runId);
  return { ok: true };
}
