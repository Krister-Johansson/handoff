import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { PageHeader } from "@/components/page-header";
import { AgentConnection } from "@/components/settings/agent-connection";
import { NotificationSettingsLoader } from "@/components/settings/notification-settings-loader";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { ThemeSetting } from "@/components/settings/theme-setting";
import { lastAgentConnection } from "@/server/agent-endpoint";
import { AgentTokenStore, defaultAgentTokenFile } from "@/server/agent-token";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parseSettingsTab } from "@/lib/settings-tab";

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


/** A settings card: a small label for the group, a title, what it is for, and the setting. */
function Section({ group, title, description, children }: { group: string; title: string; description: string; children: ReactNode }) {
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">{group}</p>
        <CardTitle className="text-2xl font-semibold tracking-tight">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tab = parseSettingsTab(await searchParams);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const token = tab === "agents" ? new AgentTokenStore(defaultAgentTokenFile()).read() : undefined;
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader
        crumbs={[{ label: "Settings" }]}
        title="Settings"
        description="Settings for this dashboard. Project settings are on each project's Settings tab."
      />
      <SettingsTabs active={tab}>
        {tab === "appearance" && (
          <Section group="Preferences" title="Appearance" description="How the dashboard looks. This browser keeps the choice.">
            <ThemeSetting />
          </Section>
        )}
        {tab === "notifications" && (
          <Section group="Preferences" title="Notifications" description="How this browser tells you that a run needs you.">
            <NotificationSettingsLoader />
          </Section>
        )}
        {tab === "agents" && (
          <Section
            group="Integrations"
            title="Connect Claude Code"
            description="Let your Claude Code session see your projects and runs, start runs for issues and answer what runs ask."
          >
            <AgentConnection origin={origin} checkout={checkoutRoot()} initialToken={token} lastConnection={connectionLine()} />
          </Section>
        )}
      </SettingsTabs>
    </main>
  );
}
