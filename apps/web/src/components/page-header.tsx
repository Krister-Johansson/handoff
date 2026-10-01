"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** A place to switch to from a crumb: a sibling project, tab, graph or run. */
export type CrumbMenuItem = { label: string; href: string; current?: boolean; hint?: string };

/** One step of the trail. With `menu`, the crumb also opens a list of its siblings to switch to. */
export type Crumb = { label: string; href?: string; menu?: CrumbMenuItem[] };

/** The crumb's siblings to switch to, behind a small chevron next to the crumb. */
function CrumbMenu({ crumb }: { crumb: Crumb }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Switch from ${crumb.label}`}
        className="-ml-1 flex items-center rounded-sm p-0.5 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDownIcon className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-56 overflow-y-auto">
        {crumb.menu!.map((item) => (
          <DropdownMenuItem key={item.href} asChild>
            <Link href={item.href}>
              <CheckIcon className={item.current ? "" : "invisible"} />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint && <span className="text-xs text-muted-foreground">{item.hint}</span>}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The breadcrumb trail on its own, for pages such as the graph editor that keep the whole height for their canvas. */
export function PageTrail({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <Fragment key={crumb.href ?? crumb.label}>
              {i > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {last || !crumb.href ? (
                  <BreadcrumbPage className="max-w-80 truncate">{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href} className="max-w-64 truncate">
                      {crumb.label}
                    </Link>
                  </BreadcrumbLink>
                )}
                {crumb.menu?.length ? <CrumbMenu crumb={crumb} /> : null}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/**
 * Every page's header: the trail of where it sits (each step a link, and a menu where there are
 * siblings to switch to), then the title with its description and the page's actions.
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
    <header className={cn("flex flex-col gap-3", className)}>
      <PageTrail crumbs={crumbs} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight break-words">
            {title}
            {titleExtra}
          </h1>
          {description && <div className="text-sm text-muted-foreground">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
