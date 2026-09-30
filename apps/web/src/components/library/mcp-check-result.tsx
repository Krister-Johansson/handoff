"use client";

import type { McpCheck } from "@handoff/engine/mcp-check";
import { StatusBadge } from "@/components/runs/status-badge";
import { Button } from "@/components/ui/button";
import { allowedFromTicked, tickedTools } from "@/lib/allowed-tools";
import { formatDuration } from "@/lib/format";
import { CHECK_STATUS } from "@/lib/mcp-check-status";
import { McpToolPicker } from "./mcp-tool-picker";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** A check's outcome: status, server, counts and what to do when it did not connect. */
export function McpCheckStatus({ check, onUseOAuth }: { check: McpCheck; onUseOAuth?: (() => void) | undefined }) {
  const status = CHECK_STATUS[check.status];
  return (
    <>
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
    </>
  );
}

/** What a server check found, with its tools ticked as allowed; unticking one restricts runs to the rest. */
export function McpCheckResult({
  check,
  allowed,
  onAllowedChange,
  onUseOAuth,
}: {
  check: McpCheck;
  allowed: string[];
  onAllowedChange: (allowed: string[]) => void;
  onUseOAuth?: () => void;
}) {
  const names = check.tools.map((t) => t.name);
  const ticked = tickedTools(names, allowed);
  const toggle = (name: string, on: boolean) => {
    const next = new Set(ticked);
    if (on) next.add(name);
    else next.delete(name);
    // An empty list means every tool, so the last ticked tool stays ticked.
    if (next.size === 0) return;
    onAllowedChange(allowedFromTicked(names, next));
  };
  return (
    <section aria-label="Server check" className="flex flex-col gap-3 rounded-lg border p-4">
      <McpCheckStatus check={check} onUseOAuth={onUseOAuth} />
      {check.tools.length > 0 && <McpToolPicker tools={check.tools} ticked={ticked} onToggle={toggle} />}
    </section>
  );
}
