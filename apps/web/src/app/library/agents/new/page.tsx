import { AgentForm } from "@/components/library/forms";
import { EntryPage } from "@/components/library/entry-page";
import { Card, CardContent } from "@/components/ui/card";

export default function NewAgentPage() {
  return (
    <EntryPage tab="agents" kind="agent" title="New agent" subtitle="A subagent a node's Claude session can delegate to.">
      <Card className="max-w-2xl">
        <CardContent>
          <AgentForm />
        </CardContent>
      </Card>
    </EntryPage>
  );
}
