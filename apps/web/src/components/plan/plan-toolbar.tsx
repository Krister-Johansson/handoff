"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChartGanttIcon, ChevronsDownUpIcon, ChevronsUpDownIcon, KanbanIcon, ListTreeIcon, WandSparklesIcon, WaypointsIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { planPath } from "@/lib/paths";
import type { PlanFilters } from "@/lib/plan/filters";
import type { PlanModeName, PlanViewName } from "@/lib/project-tab";
import { useFlowSelection } from "./plan-context";
import { SEGMENTED, SEGMENTED_ITEM } from "./segmented";
import { useCollapsed } from "./use-collapsed";

type ViewChoice = { value: PlanViewName; label: string; icon: ReactNode };

const TREE_AND_BOARD: ViewChoice[] = [
  { value: "tree", label: "Tree", icon: <ListTreeIcon /> },
  { value: "board", label: "Board", icon: <KanbanIcon /> },
];
/** The third view follows the plan mode; there is no switch between Flow and Timeline on the Plan page. */
const MODE_VIEW: Record<PlanModeName, ViewChoice> = {
  timeline: { value: "timeline", label: "Timeline", icon: <ChartGanttIcon /> },
  flow: { value: "flow", label: "Flow", icon: <WaypointsIcon /> },
};

/** Tree, Board and Timeline or Flow; under 640 px icons only, each keeping its name for screen readers and as a tooltip. */
function ViewToggle({ projectId, view, filters, mode }: { projectId: string; view: PlanViewName; filters: PlanFilters; mode: PlanModeName }) {
  const router = useRouter();
  const views = [...TREE_AND_BOARD, MODE_VIEW[mode]];
  return (
    <ToggleGroup
      type="single"
      spacing={0.5}
      className={SEGMENTED}
      value={view}
      onValueChange={(v) => v && router.replace(planPath(projectId, { ...filters, view: v as PlanViewName }), { scroll: false })}
      aria-label="View"
    >
      {views.map((v) => (
        <Tooltip key={v.value}>
          <TooltipTrigger asChild>
            <ToggleGroupItem value={v.value} aria-label={v.label} className={SEGMENTED_ITEM}>
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
 * The Flow's toolbar part for Optimize (docs/plans/flow.md, Decisions 11 and 13): how many items are ticked in
 * the tree, with a way to clear them, and Optimize, which shows its preview over the ticked items or the whole
 * plan and hides it on a second press.
 */
export function OptimizeControls() {
  const selection = useFlowSelection();
  if (!selection) return null;
  const { picks, setPicks, previewing, setPreviewing } = selection;
  return (
    <>
      {picks.size > 0 && (
        <span className="inline-flex h-8 items-center gap-1 rounded-md border border-active-dot/40 bg-active-bg pr-1 pl-2.5 text-xs font-medium whitespace-nowrap text-active">
          {picks.size} selected
          <Button variant="ghost" size="icon-xs" aria-label="Clear the selection" title="Clear the selection" className="text-active hover:bg-active-dot/15" onClick={() => setPicks(new Set())}>
            <XIcon />
          </Button>
        </span>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="sm" aria-pressed={previewing} className="aria-pressed:border-foreground/70 aria-pressed:bg-muted" onClick={() => setPreviewing(!previewing)}>
            <WandSparklesIcon />
            Optimize
          </Button>
        </TooltipTrigger>
        <TooltipContent>{picks.size > 0 ? `Optimize the ${picks.size} selected` : "Optimize the whole plan"}</TooltipContent>
      </Tooltip>
    </>
  );
}

/**
 * The Plan page's one toolbar row: the view, Expand all and Collapse all, the search, the filters, and in
 * Timeline or Flow that view's own controls at the right end. It wraps by groups on narrow screens.
 */
export function PlanToolbar({
  projectId,
  view,
  mode,
  filters,
  expand,
  search,
  filterButtons,
  controls,
}: {
  projectId: string;
  view: PlanViewName;
  /** The project's plan mode, which names the third view. */
  mode: PlanModeName;
  filters: PlanFilters;
  expand?: ReactNode;
  search?: ReactNode;
  filterButtons: ReactNode;
  controls?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2.5">
      <ViewToggle projectId={projectId} view={view} filters={filters} mode={mode} />
      {expand}
      {search}
      {filterButtons}
      {controls}
    </div>
  );
}
