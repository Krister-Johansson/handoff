import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "handoff",
  description: "Graph orchestrator for coding agents",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // Browser extensions (for example Scribe) add attributes to <html> before hydration.
    <html lang="en" className={cn("font-sans", geist.variable)} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
