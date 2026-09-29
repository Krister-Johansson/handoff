import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { SiteHeader } from "@/components/site-header";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "handoff",
  description: "Graph orchestrator for coding agents",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // Browser extensions (for example Scribe) add attributes to <html> before hydration.
    <html lang="en" className={cn("font-sans", geist.variable)} suppressHydrationWarning>
      <body className="min-h-svh bg-background">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
