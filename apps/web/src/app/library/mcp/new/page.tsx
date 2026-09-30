import { EntryPage } from "@/components/library/entry-page";
import { NewMcpServer } from "@/components/library/new-mcp-server";

export default function NewMcpServerPage() {
  return (
    <EntryPage tab="mcp" kind="mcp" title="New MCP server" subtitle="A server nodes can enable by name. Secrets stay in the worker environment.">
      <NewMcpServer />
    </EntryPage>
  );
}
