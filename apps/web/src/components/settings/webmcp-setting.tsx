"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useHasWebMcp, useWebMcpEnabled, writeWebMcpEnabled } from "@/lib/assistant/webmcp-pref";
import { cn } from "@/lib/utils";

/**
 * Whether agents in this browser see the dashboard's tools through WebMCP, kept in this browser. Without
 * WebMCP the switch is off and says how to get it in Chrome.
 */
export function WebMcpSetting() {
  const enabled = useWebMcpEnabled();
  const hasWebMcp = useHasWebMcp();
  return (
    <div className="flex items-center justify-between gap-6 text-sm">
      <div className={cn("flex max-w-[460px] flex-col gap-0.5", !hasWebMcp && "opacity-55")}>
        <Label htmlFor="webmcp">Expose tools to browser agents (WebMCP)</Label>
        <span className="text-xs leading-normal text-muted-foreground">
          {hasWebMcp ? (
            "Browser agents on this page can use handoff's tools. Anything that changes something waits for your approval in the assistant."
          ) : (
            <>
              Your browser has no WebMCP. In Chrome, enable <code className="rounded border bg-muted px-1 font-mono text-[11.5px] whitespace-nowrap">chrome://flags/#enable-webmcp-testing</code> to try it.
            </>
          )}
        </span>
      </div>
      <Switch id="webmcp" checked={hasWebMcp && enabled} disabled={!hasWebMcp} onCheckedChange={writeWebMcpEnabled} />
    </div>
  );
}
