import type { ReactNode } from "react";
import Link from "next/link";
import { BellIcon, CircleAlertIcon, CircleCheckIcon, CircleXIcon } from "lucide-react";
import { formatAgo } from "@/lib/format";
import type { NotificationTone } from "@/lib/notifications";
import { cn } from "@/lib/utils";

/** Each tone's icon and the colours of its tile. */
const TONE_STYLE: Record<NotificationTone, { icon: typeof BellIcon; tile: string }> = {
  neutral: { icon: BellIcon, tile: "bg-muted text-muted-foreground" },
  success: { icon: CircleCheckIcon, tile: "bg-success-bg text-success" },
  attention: { icon: CircleAlertIcon, tile: "bg-attention-bg text-attention" },
  danger: { icon: CircleXIcon, tile: "bg-danger-bg text-danger" },
};

/** A notification's icon on a small tile in its tone. */
export function ToneTile({ tone, className }: { tone: NotificationTone; className?: string }) {
  const { icon: Icon, tile } = TONE_STYLE[tone];
  return (
    <span aria-hidden className={cn("inline-grid size-7 shrink-0 place-items-center rounded-[7px] [&_svg]:size-3.5", tile, className)}>
      <Icon />
    </span>
  );
}

/** The dot that marks an unread notification; a blank of the same size keeps read ones aligned. */
export function UnreadDot({ unread, className }: { unread: boolean; className?: string }) {
  return unread ? <span aria-label="unread" className={cn("size-[7px] rounded-full bg-active-dot", className)} /> : <span aria-hidden className={cn("size-[7px]", className)} />;
}

/** A notification's row: a link to the page it leads to, or plain text when it leads nowhere. */
export function NotificationLink({ href, className, onClick, children }: { href: string | null; className: string; onClick?: (() => void) | undefined; children: ReactNode }) {
  if (!href) return <div className={className}>{children}</div>;
  return (
    <Link href={href} onClick={onClick} className={cn("hover:bg-muted", className)}>
      {children}
    </Link>
  );
}

export type NotificationRow = { id: string; tone: NotificationTone; title: string; body: string; href: string | null; createdAt: Date | string; unread: boolean };

/** Notifications newest first, each linking to the page its sender gave it, unread ones marked with a dot. The bell shows these. */
export function NotificationList({ items, now, onNavigate }: { items: NotificationRow[]; now?: Date; onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-px">
      {items.map((item) => {
        const at = new Date(item.createdAt);
        return (
          <li key={item.id}>
            <NotificationLink
              href={item.href}
              onClick={onNavigate}
              className={cn("grid grid-cols-[10px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-md p-2", item.unread && "bg-active-bg/55", item.unread && item.href && "hover:bg-active-bg")}
            >
              <UnreadDot unread={item.unread} className="mt-1.5" />
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] font-medium">{item.title}</span>
                <span className="mt-px line-clamp-2 text-xs text-muted-foreground">{item.body}</span>
              </span>
              <span className="mt-0.5 text-[11px] whitespace-nowrap text-muted-foreground" title={at.toISOString()}>
                {formatAgo(at, now)}
              </span>
            </NotificationLink>
          </li>
        );
      })}
    </ul>
  );
}
