import { appView } from "@/server/mcp-apps";
import { sandboxProxyOrigin } from "@/server/mcp-apps-sandbox";
import { isSameLocalOrigin } from "@/server/local-request";

export const dynamic = "force-dynamic";

/**
 * A tool's MCP Apps view, for the assistant panel to draw the call as a card: the view's HTML, CSP, permissions and
 * border, and the address of the sandbox proxy page that frames it for this dashboard.
 */
export async function GET(request: Request) {
  if (!isSameLocalOrigin(request.headers.get("origin"), request.headers.get("host"))) return Response.json({ error: "forbidden" }, { status: 403 });
  const view = appView(new URL(request.url).searchParams.get("uri") ?? "");
  if (!view) return Response.json({ error: "There is no such view." }, { status: 404 });
  // The dashboard as the browser names it, from the Host header: Next gives request.url the name it listens on,
  // which may be another of this machine's names, and the proxy may only be framed by the page's own origin.
  const dashboard = `${new URL(request.url).protocol}//${request.headers.get("host")}`;
  const sandbox = `${await sandboxProxyOrigin()}/sandbox?host=${encodeURIComponent(dashboard)}`;
  return Response.json({ ...view, sandbox });
}
