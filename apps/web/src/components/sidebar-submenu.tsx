"use client";

import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/** One item of a submenu: a view of the plan or a filter of the runs, with an optional count. */
export type SubItem = { label: string; href: string; current: boolean; count?: number };

/**
 * Where the open page sits in a section: on a page no sub item names (the parent is current), on a sub
 * item's page (the parent turns to full foreground, the sub item is current), or outside the section.
 */
export type SectionPlace = "parent" | "sub" | "outside";

/** A sidebar row: muted until it is the current page. */
export const ROW = "font-medium text-muted-foreground data-active:text-sidebar-accent-foreground";
/** A row in the phone sheet, 40 px tall for touch; sub rows there are 36 px. */
export const PHONE_ROW = "h-10";

const named = (item: SubItem) => (item.count ? `${item.label}, ${item.count}` : undefined);

function Count({ value }: { value?: number }) {
  return value ? <span className="ml-auto text-[11.5px] font-normal text-muted-foreground tabular-nums">{value}</span> : null;
}

/**
 * A sidebar row with a submenu, such as Plan with its views or Runs with its filters. Expanded, the label
 * links to the section's page and a chevron beside it folds the sub items, whose open state the parent
 * keeps. Collapsed to icons, a click opens the sub items as a flyout to the right, headed by the
 * section's name, with `all` first when the section has an item for all of it.
 */
export function SidebarSubmenu({
  label,
  href,
  icon: Icon,
  place,
  items,
  all,
  open,
  onOpenChange,
  toggleLabel,
  name,
  badge,
}: {
  label: string;
  href: string;
  icon: ComponentType;
  place: SectionPlace;
  items: SubItem[];
  /** The flyout's first item, for the whole section, such as All runs. */
  all?: SubItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The chevron's and the sub list's accessible name, such as Plan views. */
  toggleLabel: string;
  /** The parent's accessible name when it says more than the label, such as a count. */
  name?: string;
  /** Shown beside the label while the submenu is closed. */
  badge?: ReactNode;
}) {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const close = () => setOpenMobile(false);
  if (state === "collapsed" && !isMobile) {
    return (
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton isActive={place !== "outside"} tooltip={name ?? label} aria-label={name ?? label} className={ROW}>
              <Icon />
              <span>{label}</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" sideOffset={8} className="w-56">
            <DropdownMenuLabel className="flex items-center gap-2 font-semibold [&>svg]:size-3.5 [&>svg]:text-muted-foreground">
              <Icon />
              {label}
            </DropdownMenuLabel>
            {all && (
              <>
                <FlyoutItem item={all} onSelect={close} />
                <DropdownMenuSeparator />
              </>
            )}
            {items.map((item) => (
              <FlyoutItem key={item.href} item={item} onSelect={close} />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    );
  }
  const subId = `${toggleLabel.toLowerCase().replace(/\s+/g, "-")}-sub`;
  return (
    <Collapsible asChild open={open} onOpenChange={onOpenChange}>
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          isActive={place === "parent"}
          className={cn(ROW, place === "sub" && "text-sidebar-foreground", isMobile && PHONE_ROW, "group-has-data-[sidebar=menu-action]/menu-item:pr-9")}
        >
          <Link href={href} aria-current={place === "parent" ? "page" : undefined} aria-label={!open ? name : undefined} onClick={close}>
            <Icon />
            <span>{label}</span>
          </Link>
        </SidebarMenuButton>
        {!open && badge}
        <CollapsibleTrigger asChild>
          <SidebarMenuAction
            aria-label={toggleLabel}
            aria-controls={subId}
            className={cn(
              "top-1 size-6 text-muted-foreground peer-data-[size=default]/menu-button:top-1 data-[state=open]:[&>svg]:rotate-90 [&>svg]:size-3.5 [&>svg]:transition-transform",
              isMobile && "top-1.5 size-7 peer-data-[size=default]/menu-button:top-1.5",
            )}
          >
            <ChevronRightIcon />
          </SidebarMenuAction>
        </CollapsibleTrigger>
        <CollapsibleContent id={subId}>
          <SidebarMenuSub aria-label={toggleLabel} className="mr-0 gap-0.5">
            {items.map((item) => (
              <SidebarMenuSubItem key={item.href}>
                <SidebarMenuSubButton
                  asChild
                  isActive={item.current}
                  className={cn("text-muted-foreground data-active:font-medium", isMobile && "h-9")}
                >
                  <Link href={item.href} aria-current={item.current ? "page" : undefined} aria-label={named(item)} onClick={close}>
                    <span>{item.label}</span>
                    <Count value={item.count} />
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

/** A flyout item: a link with a check on the current page and its count. */
function FlyoutItem({ item, onSelect }: { item: SubItem; onSelect: () => void }) {
  return (
    <DropdownMenuItem asChild role="menuitemradio" aria-checked={item.current} className="data-[current=true]:font-medium" data-current={item.current}>
      <Link href={item.href} onClick={onSelect}>
        <span aria-hidden className="grid size-4 place-items-center">
          {item.current && <CheckIcon />}
        </span>
        <span>{item.label}</span>
        <Count value={item.count} />
      </Link>
    </DropdownMenuItem>
  );
}
