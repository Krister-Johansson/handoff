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
import { AssistantSheet } from "@/components/assistant/assistant-sheet";
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
                  sidebar={<AppSidebarData lastProjectId={lastProjectId} />}
                  // From 1280 px the assistant docks beside the page; below that it is a sheet over it.
                  panel={<AssistantSheet />}
                >
                  {children}
                </AppShell>
                <VoiceHotkeys />
                <VoiceBubble />
                <Toaster position="bottom-right" closeButton />
              </VoiceProvider>
            </AssistantProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
