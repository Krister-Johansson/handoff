import { McpServerForm } from "@/components/library/forms";
import { EntryPage } from "@/components/library/entry-page";
import { Card, CardContent } from "@/components/ui/card";

export default function NewMcpServerPage() {
  return (
    <EntryPage tab="mcp" kind="mcp" title="New MCP server" subtitle="A server nodes can enable by name. Secrets stay in the worker environment.">
      <Card className="max-w-2xl">
        <CardContent>
          <McpServerForm />
        </CardContent>
      </Card>
    </EntryPage>
  );
}
