import { registerAppResource, RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RUN_CARD_HTML } from "../mcp-apps/run-card.generated";

/** The run card's ui:// resource: get_run's result drawn as a card by hosts that render MCP Apps. */
export const RUN_CARD_URI = "ui://handoff/run-card.html";

/**
 * The views of MCP Apps (specification 2026-01-26), by the tool whose result each draws. A host that renders
 * them reads the tool's _meta.ui.resourceUri; every other client shows the tool's text result as before.
 */
const VIEWS: Record<string, string> = { get_run: RUN_CARD_URI };

/** The _meta that links a tool to its view: ui.resourceUri, and the flat key hosts read before it. */
export function appMetaOf(tool: string): Record<string, unknown> | undefined {
  const uri = VIEWS[tool];
  return uri ? { ui: { resourceUri: uri }, [RESOURCE_URI_META_KEY]: uri } : undefined;
}

/**
 * Registers the views as resources. Each is one HTML document with its script and style inline, so its
 * content security policy allows no other origin.
 */
export function registerAppResources(server: McpServer) {
  registerAppResource(server, "Run card", RUN_CARD_URI, { description: "A handoff run as a card: status, issue, steps, cost, pull request and what it waits on." }, async () => ({
    contents: [
      {
        uri: RUN_CARD_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: RUN_CARD_HTML,
        _meta: { ui: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] }, prefersBorder: false } },
      },
    ],
  }));
}
