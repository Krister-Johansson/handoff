import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@xyflow/react/dist/style.css";
import "./globals.css";
import { Geist, Geist_Mono } from "next/font/google";
import { cn } from "@/lib/utils";
import { AssistantProvider } from "@/components/assistant/assistant-provider";
import { AssistantSheet } from "@/components/assistant/assistant-sheet";
import { SiteHeader } from "@/components/site-header";
import { VoiceBubble } from "@/components/voice/voice-bubble";
import { VoiceHotkeys } from "@/components/voice/voice-hotkeys";
import { VoiceProvider } from "@/components/voice/voice-provider";
import { assistantState } from "@/server/assistant/settings";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "handoff",
  description: "Graph orchestrator for coding agents",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const assistant = assistantState();
  return (
    // Browser extensions (for example Scribe) and the theme script set attributes on <html> before hydration.
    <html lang="en" className={cn("font-sans", geist.variable, geistMono.variable)} suppressHydrationWarning>
      <body className="min-h-svh bg-background">
        <ThemeProvider>
          <TooltipProvider>
            {/* The assistant lives in the root layout so its conversation stays on screen while pages change. */}
            <AssistantProvider available={assistant.available} offReason={assistant.reason ?? "no-token"}>
              <VoiceProvider>
                <SiteHeader />
                <VoiceHotkeys />
                {children}
                <AssistantSheet />
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
