import { NextResponse, type NextRequest } from "next/server";
import { getOAuthStore } from "@/lib/oauth-store";
import { completeSignIn } from "@/server/mcp-sign-in";

export const dynamic = "force-dynamic";

/** Where an MCP server's authorization server sends the browser back after sign-in. */
export async function GET(request: NextRequest) {
  const result = await completeSignIn(getOAuthStore(), request.nextUrl.searchParams);
  if ("error" in result) return new Response(`Sign-in failed: ${result.error}`, { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  return NextResponse.redirect(new URL(result.redirect, request.url));
}
