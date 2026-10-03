import type { McpUiResourceMeta } from "@modelcontextprotocol/ext-apps";
import { registerAppResource, RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NEEDS_YOU_URI, PERMISSION_CARD_URI, PLAN_LIST_URI, QUESTION_CARD_URI, RUN_CARD_URI, viewOf } from "../lib/assistant/catalog";
import { NEEDS_YOU_HTML, PERMISSION_CARD_HTML, PLAN_LIST_HTML, QUESTION_CARD_HTML, RUN_CARD_HTML } from "../mcp-apps/views.generated";

export { RUN_CARD_URI };

/** A view of MCP Apps (specification 2026-01-26): one HTML document, and the _meta.ui its resource carries. */
type AppView = { name: string; description: string; html: string; meta: McpUiResourceMeta };

/** Every view's _meta.ui: no other origin, since script and style are inline, and no host border, since each draws its own. */
const META: McpUiResourceMeta = { csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] }, prefersBorder: false };

/**
 * The views by their ui:// resource. Each is one HTML document with its script and style inline, so its content
 * security policy allows no other origin. A catalog tool names its view in `view`.
 */
const VIEWS: Record<string, AppView> = {
  [RUN_CARD_URI]: {
    name: "Run card",
    description: "A handoff run as a card: status, issue, steps, cost, pull request and what it waits on, with its permissions and questions to answer.",
    html: RUN_CARD_HTML,
    meta: META,
  },
  [NEEDS_YOU_URI]: {
    name: "Needs you",
    description: "What waits on the person across projects, in the Inbox's groups: permissions and questions to answer, reviews, pull requests, and runs that stopped or finished.",
    html: NEEDS_YOU_HTML,
    meta: META,
  },
  [PERMISSION_CARD_URI]: {
    name: "Permission card",
    description: "A permission request a step asked, with its command, and the decision answer_permission gave it.",
    html: PERMISSION_CARD_HTML,
    meta: META,
  },
  [QUESTION_CARD_URI]: {
    name: "Question card",
    description: "A question a run asked, and the answer answer_question gave it.",
    html: QUESTION_CARD_HTML,
    meta: META,
  },
  [PLAN_LIST_URI]: {
    name: "Plan list",
    description: "A project's plan as a tree: epics, stories and tasks with status, blockers, run, pull request and size, the Flow's order or the Timeline's dates, and the moves to Ready and back.",
    html: PLAN_LIST_HTML,
    meta: META,
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
