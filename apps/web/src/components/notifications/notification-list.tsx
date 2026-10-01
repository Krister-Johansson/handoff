import Link from "next/link";
import { CircleAlertIcon, CircleCheckIcon, MessageCircleQuestionIcon, PlayIcon } from "lucide-react";
import { formatAgo } from "@/lib/format";
import type { NotificationKind } from "@/lib/notifications";
import { cn } from "@/lib/utils";

const ICONS: Record<NotificationKind, { icon: typeof PlayIcon; className: string }> = {
  started: { icon: PlayIcon, className: "text-muted-foreground" },
  finished: { icon: CircleCheckIcon, className: "text-emerald-600 dark:text-emerald-400" },
  failed: { icon: CircleAlertIcon, className: "text-red-600 dark:text-red-400" },
  input: { icon: MessageCircleQuestionIcon, className: "text-amber-600 dark:text-amber-400" },
};

type Row = { id: string; kind: NotificationKind; title: string; body: string; href: string; createdAt: Date | string; unread: boolean };

/** Notifications newest first, each linking to its run or review, unread ones marked with a dot. */
export function NotificationList({ items, now, onNavigate }: { items: Row[]; now?: Date; onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => {
        const { icon: Icon, className } = ICONS[item.kind];
        const at = new Date(item.createdAt);
        return (
          <li key={item.id}>
            <Link href={item.href} onClick={onNavigate} className={cn("flex items-start gap-2.5 rounded-md px-2 py-2 hover:bg-muted", item.unread && "bg-muted/50")}>
              <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", className)} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("text-sm", item.unread && "font-medium")}>{item.title}</span>
                <span className="truncate text-xs text-muted-foreground">{item.body}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground" title={at.toISOString()}>
                {formatAgo(at, now)}
                {item.unread && <span aria-label="unread" className="size-1.5 rounded-full bg-primary" />}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
