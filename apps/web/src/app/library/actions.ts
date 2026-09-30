"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteLibraryEntry, upsertAgent, upsertGroup, upsertMcpServer, upsertSkill } from "@handoff/db";
import { getDb } from "@/lib/db";
import { parseAgentForm, parseGroupForm, parseMcpForm, parseSkillForm, type FormResult } from "@/lib/library-forms";

export type FormState = { ok?: boolean; message?: string; errors?: Record<string, string>; values?: Record<string, string> };

const valuesOf = (form: FormData) => Object.fromEntries([...form.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)]));

const SEGMENT = { skill: "skills", mcp: "mcp", agent: "agents", group: "groups" } as const;
type Kind = keyof typeof SEGMENT;

/** Saves an entry; a new one then opens its own page, an existing one stays with a saved message. */
async function save<T>(kind: Kind, form: FormData, result: FormResult<T>, write: (data: T) => Promise<{ name: string; version: number }>): Promise<FormState> {
  if (!result.ok) return { ok: false, errors: result.errors, values: valuesOf(form) };
  const row = await write(result.data);
  revalidatePath("/library");
  revalidatePath(`/library/${SEGMENT[kind]}/${row.name}`);
  if (form.get("$new")) redirect(`/library/${SEGMENT[kind]}/${row.name}`);
  return { ok: true, message: `Saved version ${row.version}.` };
}

export async function saveSkill(_: FormState, form: FormData): Promise<FormState> {
  return save("skill", form, parseSkillForm(form), (data) => upsertSkill(getDb(), data));
}

export async function saveMcpServer(_: FormState, form: FormData): Promise<FormState> {
  return save("mcp", form, parseMcpForm(form), (data) => upsertMcpServer(getDb(), data));
}

export async function saveAgent(_: FormState, form: FormData): Promise<FormState> {
  return save("agent", form, parseAgentForm(form), (data) => upsertAgent(getDb(), data));
}

export async function saveGroup(_: FormState, form: FormData): Promise<FormState> {
  return save("group", form, parseGroupForm(form), (data) => upsertGroup(getDb(), data));
}

export async function deleteEntry(form: FormData): Promise<void> {
  const kind = String(form.get("kind"));
  const name = String(form.get("name"));
  if (kind !== "skill" && kind !== "mcp" && kind !== "agent" && kind !== "group") return;
  await deleteLibraryEntry(getDb(), kind, name);
  revalidatePath("/library");
  redirect(`/library?tab=${SEGMENT[kind]}`);
}
