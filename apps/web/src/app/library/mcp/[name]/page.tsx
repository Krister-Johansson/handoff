import { notFound } from "next/navigation";
import { getLibraryByNames } from "@handoff/db";
import { McpServerForm } from "@/components/library/forms";
import { EntryPage } from "@/components/library/entry-page";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function McpServerPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const [server] = (await getLibraryByNames(getDb(), { skills: [], mcp: [decodeURIComponent(name)], agents: [] })).mcp;
  if (!server) notFound();
  return (
    <EntryPage tab="mcp" kind="mcp" title={server.name} subtitle="Saving creates a new version." name={server.name} version={server.version}>
      <Card className="max-w-2xl">
        <CardContent>
          <McpServerForm initial={server} />
        </CardContent>
      </Card>
    </EntryPage>
  );
}
