import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Count } from "@/components/inbox/inbox-sections";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

/**
 * One question the Overview answers: a heading with its count (left out when there is nothing) and a
 * link to the page that holds all of it, then its content.
 */
export function OverviewSection({
  id,
  title,
  count,
  more,
  className,
  children,
}: {
  id: string;
  title: string;
  count: number;
  more: { href: string; label: string };
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className={cn("flex min-w-0 scroll-mt-16 flex-col gap-2.5", className)}>
      <div className="flex min-h-6 items-center justify-between gap-3">
        <h2 id={`${id}-heading`} className="flex items-center gap-2 text-xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
          {title}
          {count > 0 && <Count n={count} />}
        </h2>
        <Link href={more.href} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline hover:underline-offset-3">
          {more.label}
          <ArrowRightIcon aria-hidden className="size-3" />
        </Link>
      </div>
      {children}
    </section>
  );
}

/** Rows in a card, divided by lines. */
export function OverviewList({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <ul aria-label={label} className="flex flex-col divide-y">
        {children}
      </ul>
    </Card>
  );
}

/** A section with nothing in it: one line under an icon, in a card, so the page keeps its shape. */
export function OverviewEmpty({ icon: Icon, title, description, tone = "muted" }: { icon: ComponentType; title: string; description: ReactNode; tone?: "muted" | "success" }) {
  return (
    <Card className="py-0">
      <Empty className="flex-row items-start justify-start gap-3 p-4 text-left">
        <EmptyMedia variant="icon" className={cn("mb-0", tone === "success" && "bg-success-bg text-success")}>
          <Icon />
        </EmptyMedia>
        <EmptyHeader className="max-w-none items-start gap-0.5">
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription className="text-[13px]">{description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </Card>
  );
}
