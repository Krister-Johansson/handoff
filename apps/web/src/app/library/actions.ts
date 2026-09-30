"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { deleteLibraryEntry, getLibraryByNames, recordMcpCheck, upsertAgent, upsertGroup, upsertMcpServer, upsertSkill } from "@handoff/db";
import { checkMcpServer, type McpCheck } from "@handoff/engine/mcp-check";
import { getDb } from "@/lib/db";
import { getOAuthStore } from "@/lib/oauth-store";
import { addMcpServerFromUrl } from "@/server/mcp-add";
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

export type McpTestState = { check?: McpCheck; errors?: Record<string, string> };

/**
 * Checks an MCP server with the form's current values, secrets resolved from the dashboard's
 * environment. The result is stored as the server's last check when it matches the saved configuration.
 */
export async function testMcpServerAction(_: McpTestState, form: FormData): Promise<McpTestState> {
  const parsed = parseMcpForm(form);
  if (!parsed.ok) return { errors: parsed.errors };
  const d = parsed.data;
  const auth = d.auth ?? "headers";
  const config = { name: d.name, auth, transport: d.transport, command: d.command ?? null, args: d.args ?? [], url: d.url ?? null, env: d.env ?? {}, headers: d.headers ?? {} };
  const check = await checkMcpServer(config, { secrets: process.env, oauth: getOAuthStore() });
  if (!form.get("$new")) {
    const [saved] = (await getLibraryByNames(getDb(), { skills: [], mcp: [parsed.data.name], agents: [] })).mcp;
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (
      saved &&
      saved.transport === config.transport &&
      saved.auth === auth &&
      same([saved.command, saved.args, saved.url, saved.env, saved.headers], [config.command, config.args, config.url, config.env, config.headers])
    ) {
      await recordMcpCheck(getDb(), saved.name, check);
      revalidatePath("/library");
    }
  }
  return { check };
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

export type AddFromUrlState = { error?: string; manual?: { name: string; url: string }; message?: string; values?: { url: string; name: string } };

/** Adds an http MCP server from its URL; see addMcpServerFromUrl. Redirects when it is saved. */
export async function addMcpFromUrlAction(_: AddFromUrlState, form: FormData): Promise<AddFromUrlState> {
  const values = { url: String(form.get("url") ?? ""), name: String(form.get("name") ?? "") };
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const result = await addMcpServerFromUrl(getDb(), getOAuthStore(), values, origin);
  if ("redirect" in result) {
    revalidatePath("/library");
    redirect(result.redirect);
  }
  return { ...result, values };
}
