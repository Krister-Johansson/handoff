import type { McpUiResourceMeta } from "@modelcontextprotocol/ext-apps";
import { registerAppResource, RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RUN_CARD_URI, viewOf } from "../lib/assistant/catalog";
import { RUN_CARD_HTML } from "../mcp-apps/run-card.generated";

export { RUN_CARD_URI };

/** A view of MCP Apps (specification 2026-01-26): one HTML document, and the _meta.ui its resource carries. */
type AppView = { name: string; description: string; html: string; meta: McpUiResourceMeta };

/**
 * The views by their ui:// resource. Each is one HTML document with its script and style inline, so its content
 * security policy allows no other origin. A catalog tool names its view in `view`.
 */
const VIEWS: Record<string, AppView> = {
  [RUN_CARD_URI]: {
    name: "Run card",
    description: "A handoff run as a card: status, issue, steps, cost, pull request and what it waits on.",
    html: RUN_CARD_HTML,
    meta: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] }, prefersBorder: false },
  },
};

/**
 * The _meta that links a tool to its view: ui.resourceUri, and the flat key hosts read before it. A host that
 * renders MCP Apps reads it; every other client shows the tool's text result as before.
 */
export function appMetaOf(tool: string): Record<string, unknown> | undefined {
  const uri = viewOf(tool);
  return uri ? { ui: { resourceUri: uri }, [RESOURCE_URI_META_KEY]: uri } : undefined;
}

/** A view as the assistant panel draws it: its HTML, its CSP and permissions, and whether it wants the host's border. */
export function appView(uri: string): { uri: string; html: string; csp?: McpUiResourceMeta["csp"]; permissions?: McpUiResourceMeta["permissions"]; prefersBorder?: boolean } | undefined {
  const view = Object.hasOwn(VIEWS, uri) ? VIEWS[uri] : undefined;
  if (!view) return undefined;
  const { csp, permissions, prefersBorder } = view.meta;
  return { uri, html: view.html, ...(csp ? { csp } : {}), ...(permissions ? { permissions } : {}), ...(prefersBorder !== undefined ? { prefersBorder } : {}) };
}

/** Registers the views as resources of an MCP server. */
export function registerAppResources(server: McpServer) {
  for (const [uri, view] of Object.entries(VIEWS)) {
    registerAppResource(server, view.name, uri, { description: view.description }, async () => ({
      contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: view.html, _meta: { ui: view.meta } }],
    }));
  }
}
