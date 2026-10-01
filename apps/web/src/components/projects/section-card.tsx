import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A card with a title, a description and an action in its header, and its content flush to the edges:
 * rows, a table or a padded body. The Overview and project pages build their sections from it.
 */
export function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      {(title || description || action) && (
        <CardHeader className="gap-0.5 px-5 py-4">
          {title && (
            <CardTitle className="text-sm font-semibold">
              <h2>{title}</h2>
            </CardTitle>
          )}
          {description && <CardDescription className="text-[13px]">{description}</CardDescription>}
          {action && <CardAction className="flex items-center gap-2">{action}</CardAction>}
        </CardHeader>
      )}
      {children}
    </Card>
  );
}

/** Padding for a card's body below its header. */
export const CARD_BODY = "px-5 pb-4";

/** Rows in a card, divided by lines and lit on hover. */
export const ROWS = "flex flex-col divide-y";
export const ROW = "flex min-w-0 items-center gap-3 px-5 py-2.5 hover:bg-muted";

/** Table header and cell padding that line up with a card's header. */
export const TH = "h-auto px-5 py-2 text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase";
export const TD = "px-5 py-2.5";

type TagTone = "outline" | "fill" | "attention" | "active" | "success" | "danger";
const TAG_TONE: Record<TagTone, string> = {
  outline: "border-border text-muted-foreground",
  fill: "border-transparent bg-secondary text-secondary-foreground",
  attention: "border-transparent bg-attention-bg text-attention",
  active: "border-transparent bg-active-bg text-active",
  success: "border-transparent bg-success-bg text-success",
  danger: "border-transparent bg-danger-bg text-danger",
};

/** A small square-cornered label for counts, versions and states that are not a run status. */
export function Tag({ tone = "outline", mono, className, ...props }: ComponentProps<"span"> & { tone?: TagTone; mono?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-[5px] border px-[7px] text-[11px] font-medium whitespace-nowrap [&_svg]:size-[11px]",
        TAG_TONE[tone],
        mono && "font-mono",
        className,
      )}
      {...props}
    />
  );
}

/** A row of filter links with counts, the current one lit; the filter lives in the query string. */
export function FilterLinks({ label, items }: { label: string; items: { href: string; label: string; count: number; current: boolean }[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-0.5">
      {items.map((f) => (
        <Link
          key={f.href}
          href={f.href}
          scroll={false}
          aria-current={f.current ? "page" : undefined}
          className="inline-flex items-center gap-1.5 rounded-md px-[9px] py-[5px] text-[13px] font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
        >
          {f.label} <span className="font-normal text-muted-foreground tabular-nums">{f.count}</span>
        </Link>
      ))}
    </nav>
  );
}
