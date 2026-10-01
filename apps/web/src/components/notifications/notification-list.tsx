import Link from "next/link";
import { CircleCheckIcon, CircleXIcon, GitMergeIcon, MessageCircleQuestionIcon, PlayIcon } from "lucide-react";
import { formatAgo } from "@/lib/format";
import type { NotificationKind } from "@/lib/notifications";
import { cn } from "@/lib/utils";

/** Each kind's icon and the tone of its tile. */
const KIND_STYLE: Record<NotificationKind, { icon: typeof PlayIcon; tile: string }> = {
  started: { icon: PlayIcon, tile: "bg-muted text-muted-foreground" },
  finished: { icon: CircleCheckIcon, tile: "bg-success-bg text-success" },
  failed: { icon: CircleXIcon, tile: "bg-danger-bg text-danger" },
  input: { icon: MessageCircleQuestionIcon, tile: "bg-attention-bg text-attention" },
  ready: { icon: GitMergeIcon, tile: "bg-attention-bg text-attention" },
};

/** A notification's icon on a small tile in its kind's tone. */
export function KindTile({ kind, className }: { kind: NotificationKind; className?: string }) {
  const { icon: Icon, tile } = KIND_STYLE[kind];
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

export type NotificationRow = { id: string; kind: NotificationKind; title: string; body: string; href: string; createdAt: Date | string; unread: boolean };

/** Notifications newest first, each linking to its run or review, unread ones marked with a dot. The bell shows these. */
export function NotificationList({ items, now, onNavigate }: { items: NotificationRow[]; now?: Date; onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-px">
      {items.map((item) => {
        const at = new Date(item.createdAt);
        return (
          <li key={item.id}>
            <Link
              href={item.href}
              onClick={onNavigate}
              className={cn("grid grid-cols-[10px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-md p-2 hover:bg-muted", item.unread && "bg-active-bg/55 hover:bg-active-bg")}
            >
              <UnreadDot unread={item.unread} className="mt-1.5" />
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] font-medium">{item.title}</span>
                <span className="mt-px line-clamp-2 text-xs text-muted-foreground">{item.body}</span>
              </span>
              <span className="mt-0.5 text-[11px] whitespace-nowrap text-muted-foreground" title={at.toISOString()}>
                {formatAgo(at, now)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
