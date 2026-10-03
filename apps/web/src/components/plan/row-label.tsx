"use client";

import type { ReactNode } from "react";
import { CalendarIcon, ChevronRightIcon, ExternalLinkIcon, MoreHorizontalIcon } from "lucide-react";
import type { PlanItem } from "@handoff/github";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { isHead, LABEL_WIDTH, rowLabel, type TimelineRow } from "@/lib/plan/timeline-rows";
import { taskColumn } from "@/lib/plan/task";
import { cn } from "@/lib/utils";
import { KindBadge, StatusPill } from "./plan-status";
import { IssueTitle } from "./plan-task-parts";

function Chevron({ expanded, label, onToggle }: { expanded: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
      onClick={onToggle}
      className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <ChevronRightIcon aria-hidden className={cn("size-4 transition-transform", expanded && "rotate-90")} />
    </button>
  );
}

/** An epic's or a story's menu: Open on GitHub, and Schedule where the plan has dates. */
export function ItemMenu({ item, onSchedule }: { item: PlanItem; onSchedule?: (() => void) | undefined }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label={`Actions for #${item.number}`}>
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <a href={item.url}>
              <ExternalLinkIcon />
              Open on GitHub
            </a>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {onSchedule && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={onSchedule}>
                <CalendarIcon />
                Schedule
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A task's status pill, or an epic's or a story's kind badge; nothing on the Unparented heading. */
function RowMark({ row }: { row: TimelineRow }) {
  if (row.task) {
    const column = taskColumn(row.task);
    return <StatusPill column={column} spinning={column === "Running" && row.task.run?.status === "running"} />;
  }
  return row.item ? <KindBadge kind={row.kind === "story" ? "story" : "epic"} /> : null;
}

const INDENT: Record<TimelineRow["level"], string> = {
  1: "pl-2.5",
  2: "pl-[26px]",
  3: "pl-11",
};

type RowLabelProps = {
  row: TimelineRow;
  /** Before the chevron: the Flow's tick box. */
  lead?: ReactNode;
  onToggle: () => void;
  /** Beside the title: the Timeline's warning icon. */
  flag?: ReactNode;
  /** At the right end before the menu: a sum or a size. */
  aside?: ReactNode;
  menu: ReactNode;
  /** A task's second line: its size chip, or its tags in the Flow. */
  below?: ReactNode;
  width?: number;
};

/**
 * The fixed left cell of a Timeline or Flow row: the Flow's tick box, chevron, status pill or kind badge, number and title, what
 * the view puts beside them, then the menu, and a task's second line under them.
 */
export function RowLabel({ row, lead, onToggle, flag, aside, menu, below, width = LABEL_WIDTH }: RowLabelProps) {
  const { item, task } = row;
  return (
    <div
      role="rowheader"
      className={cn(
        "sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-1 border-r border-b bg-card pr-2.5 transition-shadow",
        "group-data-[scrolled=true]/grid:shadow-[8px_0_10px_-8px_color-mix(in_oklab,var(--foreground)_25%,transparent)]",
        "group-data-[related=true]/row:bg-[linear-gradient(var(--active-bg),var(--active-bg))]",
        INDENT[row.level],
        isHead(row) && "bg-muted",
      )}
      style={{ width }}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {lead}
        {row.expanded !== undefined && <Chevron expanded={row.expanded} label={rowLabel(row)} onToggle={onToggle} />}
        <RowMark row={row} />
        {item ? <IssueTitle item={item} className={cn("text-xs", !task && "font-medium")} /> : <span className="text-[13px] font-medium">Unparented</span>}
        {flag}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {aside}
          {menu}
        </span>
      </div>
      {below}
    </div>
  );
}
