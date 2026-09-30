import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@xyflow/react/dist/style.css";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "handoff",
  description: "Graph orchestrator for coding agents",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // Browser extensions (for example Scribe) and the theme script set attributes on <html> before hydration.
    <html lang="en" className={cn("font-sans", geist.variable)} suppressHydrationWarning>
      <body className="min-h-svh bg-background">
        <ThemeProvider>
          <TooltipProvider>
            <SiteHeader />
            {children}
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
