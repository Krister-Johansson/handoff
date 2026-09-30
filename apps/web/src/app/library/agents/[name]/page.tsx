import { notFound } from "next/navigation";
import { getLibraryByNames } from "@handoff/db";
import { AgentForm } from "@/components/library/forms";
import { EntryPage } from "@/components/library/entry-page";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const [agent] = (await getLibraryByNames(getDb(), { skills: [], mcp: [], agents: [decodeURIComponent(name)] })).agents;
  if (!agent) notFound();
  return (
    <EntryPage tab="agents" kind="agent" title={agent.name} subtitle="Saving creates a new version." name={agent.name} version={agent.version}>
      <Card className="max-w-2xl">
        <CardContent>
          <AgentForm initial={agent} />
        </CardContent>
      </Card>
    </EntryPage>
  );
}
