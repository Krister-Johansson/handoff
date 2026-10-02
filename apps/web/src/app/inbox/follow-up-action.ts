"use server";

import { z } from "zod";
import { getDb } from "@/lib/db";
import { getGitHub, getProjects } from "@/lib/github";
import type { FollowUp } from "@/lib/findings";
import { createFollowUp } from "@/server/follow-up";

const FollowUpSchema = z.object({ runId: z.uuid(), questionId: z.uuid(), findings: z.array(z.number().int().nonnegative()).min(1).max(200) });

/** Opens one GitHub issue with the code review findings a person picked, by their place in the review. */
export async function createFollowUpAction(input: z.input<typeof FollowUpSchema>): Promise<{ ok: true; issue: FollowUp } | { ok: false; error: string }> {
  const parsed = FollowUpSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick at least one finding." };
  try {
    return { ok: true, issue: await createFollowUp({ db: getDb(), github: getGitHub(), projects: getProjects() }, parsed.data) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
