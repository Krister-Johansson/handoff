"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChartGanttIcon, ChevronsDownUpIcon, ChevronsUpDownIcon, KanbanIcon, ListTreeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { planPath } from "@/lib/paths";
import type { PlanFilters } from "@/lib/plan/filters";
import type { PlanViewName } from "@/lib/project-tab";
import { useCollapsed } from "./use-collapsed";

const VIEWS: { value: PlanViewName; label: string; icon: ReactNode }[] = [
  { value: "tree", label: "Tree", icon: <ListTreeIcon /> },
  { value: "board", label: "Board", icon: <KanbanIcon /> },
  { value: "timeline", label: "Timeline", icon: <ChartGanttIcon /> },
];

/** Tree, Board or Timeline; under 640 px icons only, each keeping its name for screen readers and as a tooltip. */
function ViewToggle({ projectId, view, filters }: { projectId: string; view: PlanViewName; filters: PlanFilters }) {
  const router = useRouter();
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={view}
      onValueChange={(v) => v && router.replace(planPath(projectId, { ...filters, view: v as PlanViewName }), { scroll: false })}
      aria-label="View"
    >
      {VIEWS.map((v) => (
        <Tooltip key={v.value}>
          <TooltipTrigger asChild>
            <ToggleGroupItem value={v.value} aria-label={v.label}>
              {v.icon}
              <span className="max-sm:sr-only">{v.label}</span>
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent className="sm:hidden">{v.label}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}

/**
 * Expand all and Collapse all: every epic and story, and the Unparented and Unplanned blocks, through the
 * collapse store. Each is off when it would change nothing; both are off during a search, which opens
 * rows of its own.
 */
export function ExpandCollapse({ projectId, rows, searching }: { projectId: string; rows: string[]; searching: boolean }) {
  const collapsed = useCollapsed(projectId);
  const closed = rows.filter((r) => collapsed.has(r)).length;
  const buttons = [
    { label: "Expand all", icon: <ChevronsUpDownIcon />, off: closed === 0, act: () => collapsed.expand() },
    { label: "Collapse all", icon: <ChevronsDownUpIcon />, off: closed === rows.length, act: () => collapsed.collapseAll(rows) },
  ];
  const group = (
    <ButtonGroup aria-label="Tree rows">
      {buttons.map((b) =>
        searching ? (
          <Button key={b.label} variant="outline" size="icon-sm" aria-label={b.label} disabled>
            {b.icon}
          </Button>
        ) : (
          <Tooltip key={b.label}>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label={b.label} disabled={b.off} onClick={b.act}>
                {b.icon}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{b.label}</TooltipContent>
          </Tooltip>
        ),
      )}
    </ButtonGroup>
  );
  if (!searching) return group;
  // Disabled buttons take no pointer events, so the tooltip that says why sits on the group.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{group}</span>
      </TooltipTrigger>
      <TooltipContent>Clear the search to expand or collapse</TooltipContent>
    </Tooltip>
  );
}

/**
 * The Plan page's one toolbar row: the view, Expand all and Collapse all, the search, the filters, and in
 * Timeline its own controls at the right end. It wraps by groups on narrow screens.
 */
export function PlanToolbar({
  projectId,
  view,
  filters,
  expand,
  search,
  filterButtons,
  timeline,
}: {
  projectId: string;
  view: PlanViewName;
  filters: PlanFilters;
  expand?: ReactNode;
  search?: ReactNode;
  filterButtons: ReactNode;
  timeline?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2.5">
      <ViewToggle projectId={projectId} view={view} filters={filters} />
      {expand}
      {search}
      {filterButtons}
      {timeline}
    </div>
  );
}
