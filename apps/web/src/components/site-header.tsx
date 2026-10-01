import Link from "next/link";
import { SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InboxLink } from "@/components/inbox-link";
import { NavLink } from "@/components/nav-link";
import { NotificationBell } from "@/components/notification-bell";
import { WorkerStatus } from "@/components/worker-status";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-[52px] w-full max-w-6xl items-center gap-3 px-4 sm:gap-5 sm:px-6">
        <Link href="/" aria-label="handoff" className="flex shrink-0 items-center gap-2 text-[15px] font-semibold tracking-tight">
          <span aria-hidden className="grid size-5 place-items-center rounded-md bg-primary">
            <span className="block size-2.5 rounded-[3px] border-2 border-primary-foreground" />
          </span>
          <span className="max-sm:hidden">handoff</span>
        </Link>
        {/* Runs live under their project; the Overview links to all of them. */}
        <nav className="flex items-center gap-0.5">
          <NavLink href="/projects">Projects</NavLink>
          <InboxLink />
          <NavLink href="/library">Library</NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <NotificationBell />
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" asChild>
            <Link href="/settings" aria-label="Settings">
              <SettingsIcon />
            </Link>
          </Button>
          <span className="ml-1 sm:ml-2.5">
            <WorkerStatus />
          </span>
        </div>
      </div>
    </header>
  );
}
