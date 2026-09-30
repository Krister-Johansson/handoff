import { listLibraryIndex } from "@handoff/db";
import { EntryPage } from "@/components/library/entry-page";
import { GroupForm } from "@/components/library/group-form";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function NewGroupPage() {
  const { skills, mcp, agents } = await listLibraryIndex(getDb());
  return (
    <EntryPage tab="groups" kind="group" title="New group" subtitle="A named set of library entries that a node enables as one.">
      <Card>
        <CardContent>
          <GroupForm library={{ skills: skills.map((s) => s.name), mcp: mcp.map((m) => m.name), agents: agents.map((a) => a.name) }} />
        </CardContent>
      </Card>
    </EntryPage>
  );
}
