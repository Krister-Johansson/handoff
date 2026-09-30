import { expect, test } from "vitest";
import { suggestMcpName } from "./mcp-name";

test("an MCP server's name comes from its host, without mcp, api or www and the domain ending", () => {
  expect(suggestMcpName("https://mcp.context7.com/mcp/oauth")).toBe("context7");
  expect(suggestMcpName("https://api.githubcopilot.com/mcp/")).toBe("githubcopilot");
  expect(suggestMcpName("https://www.example.co.uk/mcp")).toBe("example");
  expect(suggestMcpName("https://docs.mcp.cloudflare.com/sse")).toBe("docs-cloudflare");
  expect(suggestMcpName("http://localhost:8080/mcp")).toBe("localhost");
  expect(suggestMcpName("http://127.0.0.1:8080/mcp")).toBe("mcp-127-0-0-1");
  expect(suggestMcpName("not a url")).toBe("");
});
