// A tiny MCP server over stdio for checkMcpServer tests. It fails to start unless FIXTURE_TOKEN is set,
// so tests can see that resolved secrets reach the server's environment.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

if (process.env.FIXTURE_TOKEN !== "s3cret") {
  process.stderr.write("FIXTURE_TOKEN is not set\n");
  process.exit(2);
}
const server = new McpServer({ name: "fixture-docs", version: "1.2.3" });
server.registerTool("search", { description: "Search the docs" }, async () => ({ content: [{ type: "text", text: "found" }] }));
server.registerTool("fetch", { description: "Fetch a page" }, async () => ({ content: [{ type: "text", text: "page" }] }));
server.registerResource("readme", "docs://readme", { description: "The readme" }, async (uri) => ({ contents: [{ uri: uri.href, text: "hi" }] }));
await server.connect(new StdioServerTransport());
