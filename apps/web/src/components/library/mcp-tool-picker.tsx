"use client";

import type { McpTool } from "@handoff/engine/mcp-check";
import { Checkbox } from "@/components/ui/checkbox";

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

function Parameters({ tool }: { tool: McpTool }) {
  const args = params(tool);
  if (args.length === 0) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">Parameters</summary>
      <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
        {args.map((arg) => (
          <div key={arg.name} className="contents">
            <dt className="font-mono">
              {arg.name}
              {arg.type && <span className="text-muted-foreground">: {arg.type}</span>}
              {arg.required && <span className="text-muted-foreground"> (required)</span>}
            </dt>
            <dd className="text-muted-foreground">{arg.description}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** A server's tools with a checkbox each; ticked tools are the ones runs may use. */
export function McpToolPicker({ tools, ticked, onToggle }: { tools: McpTool[]; ticked: Set<string>; onToggle: (name: string, on: boolean) => void }) {
  return (
    <ul className="flex flex-col divide-y">
      {tools.map((tool) => (
        <li key={tool.name} className="flex items-start gap-3 py-2.5">
          <Checkbox id={`tool-${tool.name}`} aria-label={tool.name} checked={ticked.has(tool.name)} onCheckedChange={(on) => onToggle(tool.name, on === true)} className="mt-0.5" />
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={`tool-${tool.name}`} className="font-mono text-sm">
              {tool.name}
            </label>
            {tool.description && (
              <p title={tool.description} className="line-clamp-2 text-xs text-muted-foreground">
                {tool.description}
              </p>
            )}
            <Parameters tool={tool} />
          </div>
        </li>
      ))}
    </ul>
  );
}
