"use client";

import type { ReactNode } from "react";
import { TopBarCrumbs } from "@/components/top-bar";
import { cn } from "@/lib/utils";

export { PageTrail, type Crumb, type CrumbMenuItem } from "@/components/page-trail";
import type { Crumb } from "@/components/page-trail";

/**
 * Every page's header: the title with its description and the page's actions. The trail of where the
 * page sits (each step a link, and a menu where there are siblings to switch to) goes to the top bar.
 */
export function PageHeader({
  crumbs,
  title,
  titleExtra,
  description,
  actions,
  className,
}: {
  crumbs: Crumb[];
  title: ReactNode;
  /** Next to the title, such as a version badge. */
  titleExtra?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-2.5", className)}>
      <TopBarCrumbs crumbs={crumbs} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="flex flex-wrap items-center gap-2.5 text-[22px] leading-tight font-semibold tracking-[-0.015em] break-words">
            <span data-page-title>{title}</span>
            {titleExtra}
          </h1>
          {description && <div className="text-[13px] text-muted-foreground">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
