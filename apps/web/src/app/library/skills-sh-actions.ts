"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { listLibraryIndex } from "@handoff/db";
import { getDb } from "@/lib/db";
import { importSkill, type ImportResult } from "@/server/skill-import";
import { SkillsShClient, type SkillsShResult } from "@/server/skills-sh";
import type { SkillPageDetails } from "@/server/skills-sh-pages";
import { syncSkillsShRepo, type SyncReport } from "@/server/skills-sh-sync";

export type SkillsShHit = SkillsShResult & { inLibrary: string | null };
export type ImportState = { error?: string; result?: ImportResult };

const client = new SkillsShClient();

/** Searches skills.sh and marks the results the library already has, by the skills.sh id they came from. */
export async function searchSkillsShAction(query: string): Promise<{ results: SkillsShHit[] } | { error: string }> {
  if (!query.trim()) return { results: [] };
  try {
    const [results, { skills }] = await Promise.all([client.search(query.trim()), listLibraryIndex(getDb())]);
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

export type SyncState = { report?: SyncReport; error?: string };

/** Applies a skills.sh repository's ticked skills to the library: adds the new ones, removes the unticked ones. */
export async function syncRepoAction(_: SyncState, form: FormData): Promise<SyncState> {
  const repo = String(form.get("repo") ?? "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { error: "Unknown repository." };
  const want = form.getAll("want").map(String);
  try {
    const report = await syncSkillsShRepo(getDb(), client, { repo, want });
    revalidatePath("/library");
    revalidatePath(`/library/skills-sh/${repo}`);
    return { report };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/** skills.sh's details of one skill, for expanding a row in a repository's list. */
export async function skillDetailsAction(id: string): Promise<{ details: SkillPageDetails } | { error: string }> {
  try {
    return { details: await client.skillDetails(id) };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
