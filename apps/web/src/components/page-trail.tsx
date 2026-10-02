"use client";

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDownIcon } from "lucide-react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusBadge } from "@/components/runs/status-badge";
import { cn } from "@/lib/utils";

/** A place to switch to from a crumb: a sibling project, graph or run, with a hint or a run status beside it. */
export type CrumbMenuItem = { label: string; href: string; current?: boolean; hint?: string; status?: string };

/** One step of the trail. With `menu`, the crumb also opens a searchable list of its siblings, `menuLabel` naming them. */
export type Crumb = { label: string; href?: string; menu?: CrumbMenuItem[]; menuLabel?: string };

/** Matches the search against an item's label, hint and status, which cmdk passes as keywords. */
const matchItem = (_value: string, search: string, keywords?: string[]) => (keywords?.join(" ").toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0);

/**
 * A crumb with its siblings: the crumb and a chevron, anchoring a searchable list that opens under the
 * crumb's start. Picking an item goes there.
 */
function CrumbWithMenu({ crumb, menu, children }: { crumb: Crumb; menu: CrumbMenuItem[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span className="inline-flex min-w-0 items-center gap-1">
          {children}
          <PopoverTrigger
            aria-label={`Switch from ${crumb.label}`}
            className="flex items-center rounded-sm p-0.5 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted data-[state=open]:text-foreground"
          >
            <ChevronDownIcon className="size-3.5" />
          </PopoverTrigger>
        </span>
      </PopoverAnchor>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))] p-0">
        <Command filter={matchItem}>
          <CommandInput placeholder={crumb.menuLabel ? `Search ${crumb.menuLabel}` : "Search"} />
          <CommandList className="max-h-80">
            <CommandEmpty>Nothing matches.</CommandEmpty>
            <CommandGroup>
              {menu.map((item) => (
                <CommandItem
                  key={item.href}
                  value={item.href}
                  keywords={[item.label, item.hint ?? "", item.status ?? ""]}
                  data-checked={item.current ? "true" : undefined}
                  onSelect={() => {
                    setOpen(false);
                    router.push(item.href);
                  }}
                >
                  <span className={cn("min-w-0 flex-1 truncate", item.current && "font-medium")} title={item.label}>
                    {item.label}
                  </span>
                  {item.status ? <StatusBadge status={item.status} /> : item.hint && <span className="text-xs text-muted-foreground">{item.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** A crumb's name: a link back, or the current page when it is last or has nowhere to go. */
function CrumbLabel({ crumb, last }: { crumb: Crumb; last: boolean }) {
  return last || !crumb.href ? (
    <BreadcrumbPage className="max-w-80 truncate">{crumb.label}</BreadcrumbPage>
  ) : (
    <BreadcrumbLink asChild>
      <Link href={crumb.href} className="max-w-64 truncate">
        {crumb.label}
      </Link>
    </BreadcrumbLink>
  );
}

/** The breadcrumb trail of where a page sits; the top bar shows it. */
export function PageTrail({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <Breadcrumb className="text-[13px]">
      <BreadcrumbList>
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <Fragment key={crumb.href ?? crumb.label}>
              {i > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {crumb.menu?.length ? (
                  <CrumbWithMenu crumb={crumb} menu={crumb.menu}>
                    <CrumbLabel crumb={crumb} last={last} />
                  </CrumbWithMenu>
                ) : (
                  <CrumbLabel crumb={crumb} last={last} />
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
