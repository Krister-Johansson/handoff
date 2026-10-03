import { getDb } from "@/lib/db";
import { getGitHub, getProjects } from "@/lib/github";
import { CATALOG } from "@/lib/assistant/catalog";
import { runTool } from "@/server/agent-mcp";
import { isSameLocalOrigin } from "@/server/local-request";

export const dynamic = "force-dynamic";

const DATA_TOOLS = new Map(CATALOG.filter((t) => t.kind === "data").map((t) => [t.name, t]));

/**
 * Runs a data tool of the catalog for a browser agent calling the dashboard's WebMCP tools, or for an MCP
 * Apps view in the assistant panel (`?via=view`, recorded as the dashboard's). Only the dashboard's own pages
 * may call it; a confirm tool reaches it only after the person approved it in the page. The arguments are
 * checked against the catalog before the handler runs.
 */
export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  if (!isSameLocalOrigin(request.headers.get("origin"), request.headers.get("host"))) return Response.json({ error: "forbidden" }, { status: 403 });
  const { name } = await params;
  const spec = DATA_TOOLS.get(name);
  if (!spec) return Response.json({ error: `There is no tool ${name}.` }, { status: 404 });
  const parsed = spec.input.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") }, { status: 400 });
  }
  try {
    const url = new URL(request.url);
    const actor = url.searchParams.get("via") === "view" ? "dashboard" : "webmcp";
    const result = await runTool({ db: getDb(), github: getGitHub(), projects: getProjects(), baseUrl: url.origin, actor }, spec.name, parsed.data);
    return Response.json({ result });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 422 });
  }
}
