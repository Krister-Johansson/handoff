import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { headers } from "next/headers";
import { AgentConnection } from "@/components/settings/agent-connection";
import { NotificationSettingsLoader } from "@/components/settings/notification-settings-loader";
import { ThemeSetting } from "@/components/settings/theme-setting";
import { lastAgentConnection } from "@/server/agent-endpoint";
import { AgentTokenStore, defaultAgentTokenFile } from "@/server/agent-token";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/** The handoff checkout this dashboard runs from, for adding the plugin marketplace from disk. */
function checkoutRoot(from = process.cwd()): string {
  for (let dir = from; dir !== dirname(dir); dir = dirname(dir)) if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
  return from;
}

const time = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" });

/** "Last connected: claude-code 2.1.285 at Sep 30, 2026, 5:42:10 PM", from the last request to /api/mcp. */
function connectionLine(): string | undefined {
  const last = lastAgentConnection();
  return last ? `Last connected: ${last.client} at ${time.format(last.at)}.` : undefined;
}

export default async function SettingsPage() {
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const token = new AgentTokenStore(defaultAgentTokenFile()).read();
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Settings for this dashboard. Project settings are on each project&apos;s Settings tab.</p>
      </div>
      <Card id="appearance" className="max-w-2xl scroll-mt-6">
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Light, dark, or the same as your system. This browser keeps the choice.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeSetting />
        </CardContent>
      </Card>
      <Card id="agents" className="max-w-2xl scroll-mt-6">
        <CardHeader>
          <CardTitle>Connect Claude Code</CardTitle>
          <CardDescription>Let your Claude Code session see your projects and runs, start runs for issues and answer what runs ask.</CardDescription>
        </CardHeader>
        <CardContent>
          <AgentConnection origin={origin} checkout={checkoutRoot()} initialToken={token} lastConnection={connectionLine()} />
        </CardContent>
      </Card>
      <Card id="notifications" className="max-w-2xl scroll-mt-6">
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>How this browser tells you that a run needs you.</CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationSettingsLoader />
        </CardContent>
      </Card>
    </main>
  );
}
