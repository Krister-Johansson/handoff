"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { listLibrary } from "@handoff/db";
import { getDb } from "@/lib/db";
import { importSkill, type ImportResult } from "@/server/skill-import";
import { SkillsShClient, type SkillsShResult } from "@/server/skills-sh";

export type SkillsShHit = SkillsShResult & { inLibrary: string | null };
export type ImportState = { error?: string; result?: ImportResult };

const client = new SkillsShClient();

/** Searches skills.sh and marks the results the library already has, by the skills.sh id they came from. */
export async function searchSkillsShAction(query: string): Promise<{ results: SkillsShHit[] } | { error: string }> {
  if (!query.trim()) return { results: [] };
  try {
    const [results, { skills }] = await Promise.all([client.search(query.trim()), listLibrary(getDb())]);
    const byId = new Map(skills.filter((s) => s.source).map((s) => [s.source!.id, s.name]));
    return { results: results.map((r) => ({ ...r, inLibrary: byId.get(r.id) ?? null })) };
  } catch (error) {
    return { error: `Could not search skills.sh: ${(error as Error).message}` };
  }
}

/** Imports a skill and opens it; used from the browser and, to update, from an imported skill's page. */
export async function importSkillAction(_: ImportState, form: FormData): Promise<ImportState> {
  const id = String(form.get("id") ?? "");
  let result: ImportResult;
  try {
    result = await importSkill(getDb(), client, id);
  } catch (error) {
    return { error: (error as Error).message };
  }
  revalidatePath("/library");
  revalidatePath(`/library/skills/${result.name}`);
  if (form.get("$stay")) return { result };
  redirect(`/library/skills/${result.name}`);
}
