import type { McpCheck, McpTool } from "@handoff/engine/mcp-check";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Param = { name: string; type?: string; description?: string; required: boolean };

/** The parameters a tool takes, from its JSON Schema input. */
function params(tool: McpTool): Param[] {
  const schema = tool.inputSchema as { properties?: Record<string, { type?: unknown; description?: unknown }>; required?: unknown } | undefined;
  const required = new Set(Array.isArray(schema?.required) ? (schema.required as string[]) : []);
  return Object.entries(schema?.properties ?? {}).map(([name, p]) => ({
    name,
    ...(typeof p.type === "string" ? { type: p.type } : {}),
    ...(typeof p.description === "string" ? { description: p.description } : {}),
    required: required.has(name),
  }));
}

function Tool({ tool, allowed }: { tool: McpTool; allowed: boolean | undefined }) {
  const args = params(tool);
  return (
    <details className="group border-b last:border-b-0">
      <summary className="flex cursor-pointer items-center gap-3 py-2 text-sm">
        <span className="font-mono">{tool.name}</span>
        {allowed !== undefined && <Badge variant={allowed ? "secondary" : "outline"}>{allowed ? "Allowed" : "Not allowed"}</Badge>}
        <span aria-hidden className="min-w-0 flex-1 truncate text-muted-foreground group-open:hidden">{tool.description}</span>
      </summary>
      <div className="flex flex-col gap-3 pb-3 text-sm">
        {tool.description && <p className="whitespace-pre-wrap text-muted-foreground">{tool.description}</p>}
        {args.length > 0 && (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
            {args.map((arg) => (
              <div key={arg.name} className="contents">
                <dt className="font-mono text-xs">
                  {arg.name}
                  {arg.type && <span className="text-muted-foreground">: {arg.type}</span>}
                  {arg.required && <span className="text-muted-foreground"> (required)</span>}
                </dt>
                <dd className="text-muted-foreground">{arg.description}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </details>
  );
}

/** The tools an MCP server offered at its last check, and which of them runs may use. */
export function McpTools({ check, allowed, checkedLabel }: { check: McpCheck | null; allowed: string[]; checkedLabel?: string }) {
  const tools = check?.status === "ok" ? check.tools : [];
  const allowedSet = new Set(allowed);
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{check?.status === "ok" ? `${tools.length} tool${tools.length === 1 ? "" : "s"}` : "Tools"}</CardTitle>
        <CardDescription>
          {check?.status !== "ok"
            ? "Test the server to list its tools."
            : `From the check on ${checkedLabel ?? check.checkedAt}. ${allowed.length ? "Only allowed tools reach runs." : "Every tool is allowed in runs."}`}
        </CardDescription>
      </CardHeader>
      {tools.length > 0 && (
        <CardContent>
          {tools.map((tool) => (
            <Tool key={tool.name} tool={tool} allowed={allowedSet.size ? allowedSet.has(tool.name) : undefined} />
          ))}
        </CardContent>
      )}
    </Card>
  );
}
