import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AttentionNotifier } from "@/components/attention-notifier";
import { InboxLink } from "@/components/inbox-link";
import { WorkerStatus } from "@/components/worker-status";

const links = [
  { href: "/projects", label: "Projects" },
  { href: "/runs", label: "Runs" },
  { href: "/library", label: "Library" },
];

export function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-6">
        <Link href="/" className="font-semibold tracking-tight">
          handoff
        </Link>
        <nav className="flex items-center gap-1">
          {links.map((link) => (
            <Button key={link.href} variant="ghost" size="sm" asChild>
              <Link href={link.href}>{link.label}</Link>
            </Button>
          ))}
          <InboxLink />
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <AttentionNotifier />
          <WorkerStatus />
        </div>
      </div>
    </header>
  );
}
