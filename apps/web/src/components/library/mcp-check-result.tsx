"use client";

import { useState } from "react";
import type { McpCheck } from "@handoff/engine/mcp-check";
import { StatusBadge } from "@/components/runs/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { formatDuration } from "@/lib/format";
import { CHECK_STATUS } from "@/lib/mcp-check-status";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;


/** What a server check found: status, server, tools (tickable, to become the allowed tools), resources, prompts. */
export function McpCheckResult({ check, onAllow, onUseOAuth }: { check: McpCheck; onAllow: (tools: string[]) => void; onUseOAuth?: () => void }) {
  const [ticked, setTicked] = useState(() => new Set(check.tools.map((t) => t.name)));
  const status = CHECK_STATUS[check.status];
  const toggle = (name: string, on: boolean) => {
    const next = new Set(ticked);
    if (on) next.add(name);
    else next.delete(name);
    setTicked(next);
  };
  return (
    <section aria-label="Server check" className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <StatusBadge status={status.tone} label={status.label} />
        {check.server && (
          <span className="font-mono">
            {check.server.name} {check.server.version}
          </span>
        )}
        <span className="text-muted-foreground">in {formatDuration(check.durationMs)}</span>
        {check.status === "ok" && (
          <span className="text-muted-foreground">
            {plural(check.tools.length, "tool")}, {plural(check.resources, "resource")}, {plural(check.prompts, "prompt")}
          </span>
        )}
      </div>
      {check.message && <pre className="max-h-48 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap">{check.message}</pre>}
      {check.oauthAvailable && onUseOAuth && (
        <Button type="button" size="sm" variant="outline" className="self-start" onClick={onUseOAuth}>
          Use OAuth sign-in
        </Button>
      )}
      {check.tools.length > 0 && (
        <>
          <ul className="flex flex-col gap-2">
            {check.tools.map((tool) => (
              <li key={tool.name}>
                <Field orientation="horizontal" className="items-start">
                  <Checkbox id={`tool-${tool.name}`} checked={ticked.has(tool.name)} onCheckedChange={(on) => toggle(tool.name, on === true)} />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <FieldLabel htmlFor={`tool-${tool.name}`} className="font-mono text-xs">
                      {tool.name}
                    </FieldLabel>
                    {tool.description && (
                      <span title={tool.description} className="line-clamp-2 text-xs text-muted-foreground">
                        {tool.description}
                      </span>
                    )}
                    {tool.inputSchema !== undefined && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground">Input schema</summary>
                        <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted/50 p-2 font-mono">{JSON.stringify(tool.inputSchema, null, 2)}</pre>
                      </details>
                    )}
                  </div>
                </Field>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => onAllow(check.tools.filter((t) => ticked.has(t.name)).map((t) => t.name))}>
              Allow only the ticked tools
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => onAllow([])}>
              Allow every tool
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
