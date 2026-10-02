import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { liveWorkers } from "@handoff/db";
import { PageHeader } from "@/components/page-header";
import { AgentConnection } from "@/components/settings/agent-connection";
import { NotificationSettingsLoader } from "@/components/settings/notification-settings-loader";
import { SettingsNav } from "@/components/settings/settings-nav";
import { VoiceSettingsLoader } from "@/components/settings/voice-settings-loader";
import { ThemeSetting } from "@/components/settings/theme-setting";
import { AssistantSettings } from "@/components/settings/assistant-settings";
import { WorkerSettings } from "@/components/settings/worker-settings";
import { lastAgentConnection } from "@/server/agent-endpoint";
import { lastAssistantModel } from "@/server/assistant/conversations";
import { assistantState } from "@/server/assistant/settings";
import { elevenLabsConfig, listElevenLabsVoices } from "@/server/voice/elevenlabs";
import { AgentTokenStore, defaultAgentTokenFile } from "@/server/agent-token";
import { workerSummary } from "@/server/workers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/lib/db";
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

/** Live workers, the queued runs waiting for one, and the moment they were read, for heartbeat ages. */
async function loadWorkers() {
  const db = getDb();
  const [workers, { queuedRuns }] = await Promise.all([liveWorkers(db, 60_000), workerSummary(db)]);
  return { workers, queuedRuns, now: new Date() };
}

/** The ElevenLabs voices for the Voice tab, read with the key on the server; undefined without a key. */
async function loadElevenLabsVoices() {
  const { apiKey } = elevenLabsConfig();
  if (!apiKey) return undefined;
  try {
    return { voices: await listElevenLabsVoices(apiKey) };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/** A settings card: a title, what it is for, and the settings. */
function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card className="max-w-[760px] gap-0 py-0">
      <CardHeader className="px-5 py-4">
        <CardTitle className="text-sm font-semibold">
          <h2>{title}</h2>
        </CardTitle>
        <CardDescription className="text-[13px]">{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-4">{children}</CardContent>
    </Card>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tab = parseSettingsTab(await searchParams);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const token = tab === "agents" ? new AgentTokenStore(defaultAgentTokenFile()).read() : undefined;
  const worker = tab === "worker" ? await loadWorkers() : undefined;
  const voice = tab === "voice" ? await loadElevenLabsVoices() : undefined;
  const assistant = tab === "assistant" ? { state: assistantState(), lastModel: await lastAssistantModel(getDb()) } : undefined;
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader
        crumbs={[{ label: "Settings" }]}
        title="Settings"
        description="Settings for this dashboard. Each project's own settings are under Project settings in the sidebar."
      />
      <div className="grid items-start gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
        <SettingsNav active={tab} />
        <div className="flex min-w-0 flex-col gap-4">
          {tab === "appearance" && (
            <Section title="Appearance" description="How the dashboard looks. This browser keeps the choice.">
              <ThemeSetting />
            </Section>
          )}
          {tab === "notifications" && (
            <Section title="Notifications" description="How this browser tells you that a run needs you.">
              <NotificationSettingsLoader />
            </Section>
          )}
          {tab === "voice" && (
            <Section title="Voice" description="Push to talk: the dashboard listens only after you press the microphone or V, and stops on Escape.">
              <VoiceSettingsLoader {...(voice ? { elevenLabs: voice } : {})} />
            </Section>
          )}
          {tab === "agents" && (
            <Section title="Connect Claude Code" description="Let your Claude Code session see your projects and runs, start runs for issues and answer what runs ask.">
              <AgentConnection origin={origin} checkout={checkoutRoot()} initialToken={token} lastConnection={connectionLine()} />
            </Section>
          )}
          {assistant && (
            <Section title="Assistant" description="A chat panel beside every page. It answers with Claude Code on your subscription and asks before it changes anything.">
              <AssistantSettings hasToken={Boolean(assistant.state.config.oauthToken)} enabled={assistant.state.enabled} model={assistant.state.config.model} lastModel={assistant.lastModel} />
            </Section>
          )}
          {worker && (
            <Section title="Worker" description="The process that claims queued nodes and spawns the Claude Code CLI. Started with pnpm dev:worker.">
              <WorkerSettings workers={worker.workers} queuedRuns={worker.queuedRuns} now={worker.now} />
            </Section>
          )}
        </div>
      </div>
    </main>
  );
}
