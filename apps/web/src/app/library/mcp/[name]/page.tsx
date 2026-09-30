import { notFound } from "next/navigation";
import { getLibraryByNames } from "@handoff/db";
import type { McpCheck } from "@handoff/engine/mcp-check";
import { mcpSignInStatus } from "@handoff/engine/mcp-oauth";
import { McpServerForm } from "@/components/library/forms";
import { McpSignIn } from "@/components/library/mcp-sign-in";
import { McpTools } from "@/components/library/mcp-tools";
import { EntryPage } from "@/components/library/entry-page";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/lib/db";
import { getOAuthStore } from "@/lib/oauth-store";

export const dynamic = "force-dynamic";

const time = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

function signInStatus(name: string, url: string) {
  const { expiresAt, ...status } = mcpSignInStatus(getOAuthStore(), name, url);
  return { ...status, ...(expiresAt ? { expiresAt: time.format(new Date(expiresAt)) } : {}) };
}

export default async function McpServerPage({ params, searchParams }: { params: Promise<{ name: string }>; searchParams: Promise<{ signed_in?: string; oauth_error?: string }> }) {
  const [{ name }, query] = await Promise.all([params, searchParams]);
  const [server] = (await getLibraryByNames(getDb(), { skills: [], mcp: [decodeURIComponent(name)], agents: [] })).mcp;
  if (!server) notFound();
  const check = (server.lastCheck as McpCheck | null) ?? null;
  return (
    <EntryPage tab="mcp" kind="mcp" title={server.name} subtitle="Saving creates a new version." name={server.name} version={server.version}>
      {server.transport === "http" && server.auth === "oauth" && server.url && (
        <McpSignIn
          name={server.name}
          status={signInStatus(server.name, server.url)}
          {...(query.oauth_error ? { error: query.oauth_error } : {})}
          signedIn={query.signed_in === "1"}
        />
      )}
      <McpTools check={check} allowed={server.tools} {...(check ? { checkedLabel: time.format(new Date(check.checkedAt)) } : {})} />
      <Card className="max-w-2xl">
        <CardContent>
          <McpServerForm initial={server} />
        </CardContent>
      </Card>
    </EntryPage>
  );
}
