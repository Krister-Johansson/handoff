"use client";

import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TopBar, TopBarCrumbsProvider } from "@/components/top-bar";

/**
 * The frame of every page: a Skip to content link first in the tab order, the sidebar, then the top
 * bar and the page beside it. `panel` sits beside the page column under the top bar, where the
 * assistant docks on a wide screen. `sidebarOpen` comes from the sidebar's cookie, so a reload keeps it.
 */
export function AppShell({ sidebarOpen, sidebar, panel, children }: { sidebarOpen: boolean; sidebar: ReactNode; panel?: ReactNode; children: ReactNode }) {
  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <a
        href="#content"
        className="sr-only rounded-md bg-background px-3 py-2 text-sm font-medium shadow-md ring-2 ring-ring focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </a>
      {sidebar}
      <TopBarCrumbsProvider>
        <SidebarInset className="min-w-0">
          <TopBar />
          <div className="flex min-w-0 flex-1">
            <div id="content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
              {children}
            </div>
            {panel}
          </div>
        </SidebarInset>
      </TopBarCrumbsProvider>
    </SidebarProvider>
  );
}
