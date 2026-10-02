"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useHasWebMcp, useWebMcpEnabled, writeWebMcpEnabled } from "@/lib/assistant/webmcp-pref";

/** Whether agents in this browser see the dashboard's tools through WebMCP. The choice is kept in this browser. */
export function WebMcpSetting() {
  const enabled = useWebMcpEnabled();
  const hasWebMcp = useHasWebMcp();
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="webmcp">Expose tools to browser agents (WebMCP)</Label>
          <span className="text-xs text-muted-foreground">
            Every dashboard page offers handoff&apos;s tools to an agent in this browser. Tools that change something ask you on an approval card first.
          </span>
        </div>
        <Switch id="webmcp" checked={enabled} onCheckedChange={writeWebMcpEnabled} />
      </div>
      {!hasWebMcp && (
        <p className="text-xs text-muted-foreground">
          Your browser has no WebMCP. In Chrome, enable chrome://flags/#enable-webmcp-testing to try it.
        </p>
      )}
    </div>
  );
}
