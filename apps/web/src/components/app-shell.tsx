"use client";

import type { ReactNode } from "react";
import { useOptionalAssistant } from "@/components/assistant/assistant-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { SidebarSectionProvider } from "@/components/sidebar-section";
import { TopBar, TopBarCrumbsProvider } from "@/components/top-bar";

/**
 * The frame of every page: a Skip to content link first in the tab order, the sidebar, then the top
 * bar and the page beside it. `panel` sits beside the page column under the top bar, where the
 * assistant docks on a wide screen. `overlay` floats at the bottom centre of the page column, kept in
 * the window as the page scrolls, as the voice bubble does. `sidebarOpen` comes from the sidebar's
 * cookie, so a reload keeps it.
 */
export function AppShell({
  sidebarOpen,
  sidebar,
  panel,
  overlay,
  children,
}: {
  sidebarOpen: boolean;
  sidebar: ReactNode;
  panel?: ReactNode;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  const assistantOpen = useOptionalAssistant()?.isOpen ?? false;
  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <a
        href="#content"
        className="sr-only rounded-md bg-background px-3 py-2 text-sm font-medium shadow-md ring-2 ring-ring focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </a>
      <SidebarSectionProvider>
        {sidebar}
        <TopBarCrumbsProvider>
          <SidebarInset className="min-w-0">
            <TopBar />
            <div className="flex min-w-0 flex-1">
              <div className="flex min-w-0 flex-1 flex-col">
                <div
                  id="content"
                  tabIndex={-1}
                  className="flex min-w-0 flex-1 flex-col outline-none"
                >
                  {children}
                </div>
                {overlay && (
                  // From 768 to 1280 px the open assistant floats 400 px wide over the right of the page;
                  // the overlay centres on what the panel leaves visible.
                  <div
                    data-assistant={assistantOpen ? "open" : undefined}
                    className="sticky bottom-4 z-40 h-0 sm:bottom-6 md:data-[assistant=open]:pr-[424px] xl:data-[assistant=open]:pr-0"
                  >
                    <div className="relative">{overlay}</div>
                  </div>
                )}
              </div>
              {panel}
            </div>
          </SidebarInset>
        </TopBarCrumbsProvider>
      </SidebarSectionProvider>
    </SidebarProvider>
  );
}
