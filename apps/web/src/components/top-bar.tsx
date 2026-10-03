"use client";

import { createContext, use, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { NotificationBell } from "@/components/notification-bell";
import { PageTrail, type Crumb } from "@/components/page-trail";
import { SearchCommand } from "@/components/search/search-command";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { VoiceButton } from "@/components/voice/voice-button";
import { VoiceTranscript } from "@/components/voice/voice-transcript";
import { shortcutText, useIsMac } from "@/lib/platform";

const CrumbSlot = createContext<{ slot: HTMLElement | null; setSlot: (el: HTMLElement | null) => void }>({ slot: null, setSlot: () => {} });

/** Lets the open page put its trail into the top bar, which lives in the layout above it. */
export function TopBarCrumbsProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ slot, setSlot }), [slot]);
  return <CrumbSlot value={value}>{children}</CrumbSlot>;
}

/** The page's trail, shown in the top bar. Each page names its own trail through its PageHeader. */
export function TopBarCrumbs({ crumbs }: { crumbs: Crumb[] }) {
  const { slot } = use(CrumbSlot);
  return slot ? createPortal(<PageTrail crumbs={crumbs} />, slot) : null;
}

/**
 * The bar above every page: the sidebar toggle and the page's trail on the left; search, voice and the
 * notification bell on the right. Under it, the voice transcript strip while voice has something to
 * say. The assistant opens from the assist button in the bottom right corner, not from here.
 */
export function TopBar() {
  const { setSlot } = use(CrumbSlot);
  const mac = useIsMac();
  return (
    <header data-slot="top-bar" className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur-md">
      <div className="flex h-[52px] items-center gap-2 px-2 sm:px-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarTrigger className="text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent side="bottom">Toggle sidebar ({shortcutText(mac, "B")})</TooltipContent>
        </Tooltip>
        <Separator orientation="vertical" className="mx-0.5 data-vertical:h-4 data-vertical:self-center" />
        <div ref={setSlot} className="min-w-0 flex-1 overflow-hidden" />
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <SearchCommand />
          <VoiceButton />
          <NotificationBell />
        </div>
      </div>
      <VoiceTranscript />
    </header>
  );
}
