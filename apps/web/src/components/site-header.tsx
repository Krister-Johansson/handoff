import Link from "next/link";
import { SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AttentionNotifier } from "@/components/attention-notifier";
import { InboxLink } from "@/components/inbox-link";
import { WorkerStatus } from "@/components/worker-status";


export function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-6">
        <Link href="/" className="font-semibold tracking-tight">
          handoff
        </Link>
        <nav className="flex items-center gap-1">
          {/* Runs live under their project; the Overview links to all of them. */}
          <Button variant="ghost" size="sm" asChild>
            <Link href="/projects">Projects</Link>
          </Button>
          <InboxLink />
          <Button variant="ghost" size="sm" asChild>
            <Link href="/library">Library</Link>
          </Button>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <AttentionNotifier />
          <Button variant="ghost" size="icon-sm" asChild>
            <Link href="/settings" aria-label="Settings">
              <SettingsIcon />
            </Link>
          </Button>
          <WorkerStatus />
        </div>
      </div>
    </header>
  );
}
