"use server";

import { revalidatePath } from "next/cache";
import { deleteLibraryEntry, upsertAgent, upsertMcpServer, upsertSkill } from "@handoff/db";
import { getDb } from "@/lib/db";
import { parseAgentForm, parseMcpForm, parseSkillForm, type FormResult } from "@/lib/library-forms";

export type FormState = { ok?: boolean; message?: string; errors?: Record<string, string>; values?: Record<string, string> };

const valuesOf = (form: FormData) => Object.fromEntries([...form.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)]));

async function save<T>(form: FormData, result: FormResult<T>, write: (data: T) => Promise<{ name: string; version: number }>): Promise<FormState> {
  if (!result.ok) return { ok: false, errors: result.errors, values: valuesOf(form) };
  const row = await write(result.data);
  revalidatePath("/library");
  return { ok: true, message: `Saved ${row.name} (version ${row.version}).` };
}

export async function saveSkill(_: FormState, form: FormData): Promise<FormState> {
  return save(form, parseSkillForm(form), (data) => upsertSkill(getDb(), data));
}

export async function saveMcpServer(_: FormState, form: FormData): Promise<FormState> {
  return save(form, parseMcpForm(form), (data) => upsertMcpServer(getDb(), data));
}

export async function saveAgent(_: FormState, form: FormData): Promise<FormState> {
  return save(form, parseAgentForm(form), (data) => upsertAgent(getDb(), data));
}

export async function deleteEntry(form: FormData): Promise<void> {
  const kind = String(form.get("kind"));
  const name = String(form.get("name"));
  if (kind !== "skill" && kind !== "mcp" && kind !== "agent") return;
  await deleteLibraryEntry(getDb(), kind, name);
  revalidatePath("/library");
}
