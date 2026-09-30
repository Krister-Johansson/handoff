import { notFound } from "next/navigation";
import { listLibrary } from "@handoff/db";
import { EntryPage } from "@/components/library/entry-page";
import { GroupForm } from "@/components/library/group-form";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function GroupPage({ params }: { params: Promise<{ name: string }> }) {
  const [{ name }, { skills, mcp, agents, groups }] = await Promise.all([params, listLibrary(getDb())]);
  const group = groups.find((g) => g.name === decodeURIComponent(name));
  if (!group) notFound();
  return (
    <EntryPage tab="groups" kind="group" title={group.name} subtitle="Saving creates a new version. Nodes that enable the group get the change on their next run." name={group.name} version={group.version}>
      <Card>
        <CardContent>
          <GroupForm key={group.version} library={{ skills: skills.map((s) => s.name), mcp: mcp.map((m) => m.name), agents: agents.map((a) => a.name) }} initial={group} />
        </CardContent>
      </Card>
    </EntryPage>
  );
}
