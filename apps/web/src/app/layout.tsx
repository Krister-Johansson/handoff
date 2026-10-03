import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import "@xyflow/react/dist/style.css";
import "./globals.css";
import { Geist, Geist_Mono } from "next/font/google";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/app-shell";
import { AppSidebarData } from "@/components/app-sidebar-data";
import { AssistantProvider } from "@/components/assistant/assistant-provider";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { CHATS_COOKIE } from "@/lib/assistant/chats-cookie";
import { VoiceBubble } from "@/components/voice/voice-bubble";
import { VoiceHotkeys } from "@/components/voice/voice-hotkeys";
import { VoiceProvider } from "@/components/voice/voice-provider";
import { LAST_PROJECT_COOKIE } from "@/lib/last-project";
import { assistantState } from "@/server/assistant/settings";
import { elevenLabsConfig } from "@/server/voice/elevenlabs";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "handoff",
  description: "Graph orchestrator for coding agents",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const assistant = assistantState();
  const cookieStore = await cookies();
  // The shadcn sidebar keeps its open state in sidebar_state; open unless it was closed.
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";
  const lastProjectId = cookieStore.get(LAST_PROJECT_COOKIE)?.value;
  // The sidebar's Chats group is open unless it was folded.
  const chatsOpen = cookieStore.get(CHATS_COOKIE)?.value !== "false";
  return (
    // Browser extensions (for example Scribe) and the theme script set attributes on <html> before hydration.
    <html lang="en" className={cn("font-sans", geist.variable, geistMono.variable)} suppressHydrationWarning>
      <body className="min-h-svh bg-background">
        <ThemeProvider>
          <TooltipProvider>
            {/* The assistant lives in the root layout so its conversation stays on screen while pages change. */}
            <AssistantProvider available={assistant.available} offReason={assistant.reason ?? "no-token"}>
              <VoiceProvider speechAvailable={Boolean(elevenLabsConfig().apiKey)}>
                <AppShell
                  sidebarOpen={sidebarOpen}
                  // Not behind Suspense: the sidebar hydrates with its provider, which on a phone then
                  // swaps it for a sheet. A boundary that hydrated later would see the sheet and mismatch.
                  sidebar={<AppSidebarData lastProjectId={lastProjectId} chatsOpen={chatsOpen} />}
                  // The assist button, and the panel it opens: docked beside the page from 1280 px, floating below that.
                  panel={<AssistantPanel />}
                  // The voice bubble centres on the page column, between the sidebar and a docked panel.
                  overlay={<VoiceBubble />}
                >
                  {children}
                </AppShell>
                <VoiceHotkeys />
                <Toaster position="bottom-right" closeButton />
              </VoiceProvider>
            </AssistantProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
