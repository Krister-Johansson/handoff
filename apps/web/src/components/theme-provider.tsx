"use client";

import type { ReactNode } from "react";
import { ThemeProvider as NextThemes } from "next-themes";

/** Sets the dark class on <html> from the stored choice or the system, before the page paints. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemes>
  );
}
