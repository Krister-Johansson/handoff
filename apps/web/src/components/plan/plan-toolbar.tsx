"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChartGanttIcon, KanbanIcon, ListTreeIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { planPath } from "@/lib/paths";
import type { PlanFilters } from "@/lib/plan/filters";
import type { PlanViewName } from "@/lib/project-tab";

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
