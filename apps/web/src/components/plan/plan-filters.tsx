"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, KanbanIcon, ListTreeIcon, XIcon } from "lucide-react";
import type { PlanStatus } from "@handoff/github";
import type { PlanColumn, PlanEpic } from "@/server/plan";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { planPath } from "@/lib/paths";
import { isFiltered, PLAN_STATUSES, type PlanFilters as Filters, type RunFilter } from "@/lib/plan/filters";
import type { PlanViewName } from "@/lib/project-tab";
import { COLUMN_TONE } from "@/lib/plan/task";

const RUNS: { value: RunFilter; label: string; text?: string }[] = [
  { value: "any", label: "Any" },
  { value: "active", label: "Has an active run", text: "Running, or waiting on checks, review or a person" },
  { value: "needs-you", label: "Needs you", text: "A question, a permission request or a failed step" },
  { value: "none", label: "No run", text: "No run has linked the task yet" },
];
const RUN_LABEL = Object.fromEntries(RUNS.map((r) => [r.value, r.label])) as Record<RunFilter, string>;

/** A filter's button: its name in muted text, then what it is set to. */
function FilterButton({ name, value, ...props }: { name: string; value: string } & React.ComponentProps<typeof Button>) {
  return (
    <Button variant="outline" size="sm" className="max-w-72" {...props}>
      <span className="text-muted-foreground">{name}</span> <span className="truncate">{value}</span>
      <ChevronDownIcon data-icon="inline-end" />
    </Button>
  );
}

type Props = {
  projectId: string;
  view: PlanViewName;
  filters: Filters;
  epics: PlanEpic[];
  /** Tasks per board column, for the Status filter. */
  counts: Record<PlanColumn, number>;
  /** Open issues outside the plan, for the Epic filter. */
  unplanned: number;
  /** On the right of the toolbar, such as the link to the Ready tasks in the backlog. */
  aside?: ReactNode;
};

/**
 * The Plan page's toolbar: Tree or Board, then the Epic, Status and Run filters. Every choice lives in
 * the URL, so a link or a refresh keeps it; with a filter set, a chip row undoes one or all of them.
 */
export function PlanFilters({ projectId, view, filters, epics, counts, unplanned, aside }: Props) {
  const router = useRouter();
  const [epicOpen, setEpicOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const href = (next: Partial<Filters> & { view?: PlanViewName }) => planPath(projectId, { view, ...filters, ...next });
  const go = (next: Partial<Filters> & { view?: PlanViewName }) => router.replace(href(next), { scroll: false });
  const epicTitle = (n: Filters["epic"]) => (n === "unplanned" ? "Unplanned" : (epics.find((e) => e.number === n)?.title ?? `#${n}`));
  const toggleStatus = (status: PlanStatus) =>
    go({ status: filters.status.includes(status) ? filters.status.filter((s) => s !== status) : PLAN_STATUSES.filter((s) => s === status || filters.status.includes(s)) });
  const chips = [
    filters.epic !== undefined && { label: `Epic: ${epicTitle(filters.epic)}`, href: href({ epic: undefined }) },
    filters.status.length > 0 && { label: `Status: ${filters.status.join(", ")}`, href: href({ status: [] }) },
    filters.run !== "any" && { label: `Run: ${RUN_LABEL[filters.run]}`, href: href({ run: "any" }) },
  ].filter((c): c is { label: string; href: string } => Boolean(c));

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && go({ view: v as PlanViewName })} aria-label="View">
          <ToggleGroupItem value="tree">
            <ListTreeIcon />
            Tree
          </ToggleGroupItem>
          <ToggleGroupItem value="board">
            <KanbanIcon />
            Board
          </ToggleGroupItem>
        </ToggleGroup>

        <Popover open={epicOpen} onOpenChange={setEpicOpen}>
          <PopoverTrigger asChild>
            <FilterButton name="Epic" value={filters.epic === undefined ? "All" : epicTitle(filters.epic)} />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0">
            <Command>
              <CommandInput placeholder="Find an epic" />
              <CommandList>
                <CommandEmpty>No epic matches.</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="all epics"
                    data-checked={filters.epic === undefined ? "true" : undefined}
                    onSelect={() => {
                      setEpicOpen(false);
                      go({ epic: undefined });
                    }}
                  >
                    All epics
                  </CommandItem>
                  {epics.map((epic) => (
                    <CommandItem
                      key={epic.number}
                      value={`#${epic.number} ${epic.title}`}
                      data-checked={filters.epic === epic.number ? "true" : undefined}
                      onSelect={() => {
                        setEpicOpen(false);
                        go({ epic: epic.number });
                      }}
                    >
                      <span className="font-mono text-xs text-muted-foreground">#{epic.number}</span> <span className="min-w-0 flex-1 truncate">{epic.title}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {epic.progress.done} of {epic.progress.total} done
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
                {unplanned > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem
                        value="unplanned"
                        data-checked={filters.epic === "unplanned" ? "true" : undefined}
                        onSelect={() => {
                          setEpicOpen(false);
                          go({ epic: "unplanned" });
                        }}
                      >
                        <span className="flex-1">Unplanned</span>
                        <span className="text-xs text-muted-foreground tabular-nums">{unplanned}</span>
                      </CommandItem>
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <FilterButton name="Status" value={filters.status.length === 0 ? "All" : filters.status.join(", ")} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuGroup>
              {PLAN_STATUSES.map((status) => (
                <DropdownMenuCheckboxItem key={status} checked={filters.status.includes(status)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggleStatus(status)}>
                  <span aria-hidden className={`size-2 rounded-full ${COLUMN_TONE[status].dot}`} />
                  <span className="flex-1">{status}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{counts[status]}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem disabled={filters.status.length === 0} onSelect={() => go({ status: [] })}>
                <span className="flex-1 text-muted-foreground">{filters.status.length === 0 ? "All statuses" : `${filters.status.length} of ${PLAN_STATUSES.length} statuses`}</span>
                Select all
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Popover open={runOpen} onOpenChange={setRunOpen}>
          <PopoverTrigger asChild>
            <FilterButton name="Run" value={RUN_LABEL[filters.run]} />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72">
            <RadioGroup
              value={filters.run}
              aria-label="Run"
              onValueChange={(run) => {
                setRunOpen(false);
                go({ run: run as RunFilter });
              }}
            >
              {RUNS.map((r) => (
                <Field key={r.value} orientation="horizontal">
                  <RadioGroupItem value={r.value} id={`plan-run-${r.value}`} />
                  <FieldContent>
                    <FieldLabel htmlFor={`plan-run-${r.value}`}>{r.label}</FieldLabel>
                    {r.text && <FieldDescription className="text-xs">{r.text}</FieldDescription>}
                  </FieldContent>
                </Field>
              ))}
            </RadioGroup>
          </PopoverContent>
        </Popover>

        {aside && <div className="ml-auto flex items-center">{aside}</div>}
      </div>

      {isFiltered(filters) && (
        <div className="flex flex-wrap items-center gap-2">
          <ul aria-label="Filters" className="flex flex-wrap items-center gap-1.5">
            {chips.map((chip) => (
              <li key={chip.label} className="inline-flex h-6 items-center gap-1 rounded-md bg-secondary pr-1 pl-2 text-xs">
                {chip.label}
                <Link href={chip.href} scroll={false} replace aria-label={`Remove ${chip.label}`} className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                  <XIcon aria-hidden className="size-3" />
                </Link>
              </li>
            ))}
          </ul>
          <Button variant="ghost" size="xs" asChild>
            <Link href={planPath(projectId, { view })} scroll={false} replace>
              Clear filters
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
