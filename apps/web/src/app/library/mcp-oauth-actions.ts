"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signOutMcp } from "@handoff/engine/mcp-oauth";
import { getDb } from "@/lib/db";
import { getOAuthStore } from "@/lib/oauth-store";
import { startSignIn } from "@/server/mcp-sign-in";

export type SignInState = { error?: string };

/** Sends the browser to the MCP server's authorization server; it comes back to /api/mcp-oauth/callback. */
export async function signInMcpAction(_: SignInState, form: FormData): Promise<SignInState> {
  const name = String(form.get("name") ?? "");
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const result = await startSignIn(getDb(), getOAuthStore(), name, origin);
  if ("error" in result) return { error: result.error };
  redirect(result.redirect);
}

export async function signOutMcpAction(form: FormData): Promise<void> {
  const name = String(form.get("name") ?? "");
  try {
    signOutMcp(getOAuthStore(), name);
  } catch {
    return;
  }
  revalidatePath(`/library/mcp/${encodeURIComponent(name)}`);
}
