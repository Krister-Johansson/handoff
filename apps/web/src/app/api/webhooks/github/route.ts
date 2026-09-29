import { getDb } from "@/lib/db";
import { handleGitHubWebhook } from "@/server/github-webhook";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "GITHUB_WEBHOOK_SECRET is not set" }, { status: 503 });
  return handleGitHubWebhook(getDb(), request, secret);
}
