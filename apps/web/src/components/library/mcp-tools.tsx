"use client";

import { useState, useTransition } from "react";
import { RefreshCwIcon } from "lucide-react";
import type { McpCheck } from "@handoff/engine/mcp-check";
import { checkSavedMcpAction, saveMcpToolsAction } from "@/app/library/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { allowedFromTicked, tickedTools } from "@/lib/allowed-tools";
import { McpCheckStatus } from "./mcp-check-result";
import { McpToolPicker } from "./mcp-tool-picker";

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((name, i) => name === b[i]);

/**
 * A saved server's tools from its last check, ticked as allowed. Saving stores the ticked tools as
 * the ones runs may use; Check server connects again with the saved configuration.
 */
export function McpToolsPanel({ name, check: initialCheck, allowed: initialAllowed }: { name: string; check: McpCheck | null; allowed: string[] }) {
  const [check, setCheck] = useState(initialCheck);
  const [saved, setSaved] = useState(initialAllowed);
  const names = check?.status === "ok" ? check.tools.map((t) => t.name) : [];
  const [ticked, setTicked] = useState(() => tickedTools(names, initialAllowed));
  const [error, setError] = useState<string>();
  const [saving, startSaving] = useTransition();
  const [checking, startChecking] = useTransition();

  const next = allowedFromTicked(names, ticked);
  const changed = !sameList(next, saved);
  const toggle = (tool: string, on: boolean) => {
    const set = new Set(ticked);
    if (on) set.add(tool);
    else set.delete(tool);
    setTicked(set);
  };
  const save = () =>
    startSaving(async () => {
      const result = await saveMcpToolsAction(name, next);
      if ("error" in result) setError(result.error);
      else {
        setError(undefined);
        setSaved(next);
      }
    });
  const recheck = () =>
    startChecking(async () => {
      const result = await checkSavedMcpAction(name);
      if ("error" in result) return setError(result.error);
      setError(undefined);
      setCheck(result.check);
      setTicked(tickedTools(result.check.tools.map((t) => t.name), saved));
    });

  return (
    <section aria-label="Tools" className="flex max-w-2xl flex-col gap-3">
      {check ? <McpCheckStatus check={check} /> : <p className="text-sm text-muted-foreground">Check the server to list its tools.</p>}
      {names.length > 0 && check && (
        <>
          <p className="text-sm text-muted-foreground">Ticked tools are the ones runs may use. With every tool ticked, runs may also use tools the server adds later.</p>
          <McpToolPicker tools={check.tools} ticked={ticked} onToggle={toggle} />
        </>
      )}
      {names.length > 0 && ticked.size === 0 && <FieldError>Tick at least one tool, or take the server off the nodes that use it.</FieldError>}
      {error && <FieldError>{error}</FieldError>}
      <div className="flex flex-wrap gap-2">
        {names.length > 0 && (
          <Button type="button" size="sm" disabled={!changed || ticked.size === 0 || saving} onClick={save}>
            Save allowed tools
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" disabled={checking} onClick={recheck}>
          <RefreshCwIcon data-icon="inline-start" />
          {checking ? "Checking" : "Check server"}
        </Button>
      </div>
    </section>
  );
}
