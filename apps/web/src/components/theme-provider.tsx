"use client";

import type { ReactNode } from "react";
import { ThemeProvider as NextThemes } from "next-themes";

// next-themes renders an inline script that sets the theme class. The copy in the server HTML runs before the
// page paints. A copy React creates in the browser never runs, and React logs an error for it when its type is
// JavaScript, which happens whenever the root renders on the client (after a hydration mismatch, for example).
// In the browser the script gets a non-JavaScript type, so that copy is plain data. Hydration keeps the server's
// script as it is: React does not patch attributes while hydrating, and next-themes suppresses the warning.
const scriptProps = typeof window === "undefined" ? undefined : { type: "text/plain" };

/** Sets the dark class on <html> from the stored choice or the system, before the page paints. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange scriptProps={scriptProps}>
      {children}
    </NextThemes>
  );
}
