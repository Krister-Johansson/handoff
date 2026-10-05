"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, XIcon } from "lucide-react";
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
import { planPath } from "@/lib/paths";
import { PLAN_STATUSES, type AssigneeFilter, type PlanFilters as Filters, type RunFilter } from "@/lib/plan/filters";
import type { PlanViewName } from "@/lib/project-tab";
import { COLUMN_TONE } from "@/lib/plan/task";
import { dueText } from "@/lib/plan/milestone-text";
import type { MilestoneTasks, PlanMilestone } from "@/lib/plan/milestones";
import { cn } from "@/lib/utils";

const RUNS: { value: RunFilter; label: string; text?: string }[] = [
  { value: "any", label: "Any" },
  { value: "active", label: "Has an active run", text: "Running, or waiting on checks, review or a person" },
  { value: "needs-you", label: "Needs you", text: "A question, a permission request or a failed step" },
  { value: "none", label: "No run", text: "No run has linked the task yet" },
];
const RUN_LABEL = Object.fromEntries(RUNS.map((r) => [r.value, r.label])) as Record<RunFilter, string>;

/** A filter's button: its name, then in muted text what it is set to; an unset filter shows only its name. */
function FilterButton({ name, value, ...props }: { name: string; value: string | undefined } & React.ComponentProps<typeof Button>) {
  return (
    <Button variant="outline" size="sm" className="max-w-72 gap-1 px-2.5" {...props}>
      {name}
      {value !== undefined && " "}
      {value !== undefined && <span className="truncate text-muted-foreground">{value}</span>}
      <ChevronDownIcon data-icon="inline-end" />
    </Button>
  );
}

/** What the Epic and Assignee filters say they are set to. */
const epicLabel = (epics: PlanEpic[], n: Filters["epic"]) => (n === "unplanned" ? "Unplanned" : (epics.find((e) => e.number === n)?.title ?? `#${n}`));
const assigneeLabel = (a: AssigneeFilter) => (a === "me" ? "Me" : a === "none" ? "Unassigned" : a);
const milestoneLabel = (milestones: PlanMilestone[] | undefined, m: Filters["milestone"]) =>
  m === "none" ? "No milestone" : (milestones?.find((x) => x.number === m)?.title ?? `#${m}`);

type Props = {
  projectId: string;
  view: PlanViewName;
  /** The filters with the search as it stands, so a filter link keeps the search. */
  filters: Filters;
  epics: PlanEpic[];
  /** Tasks per board column, for the Status filter. */
  counts: Record<PlanColumn, number>;
  /** Open issues outside the plan, for the Epic filter. */
  unplanned: number;
  /** The login of the token handoff uses; without one there is no Me. */
  me?: string | undefined;
  /** Everyone else assigned to a task in the plan, for the Assignee filter. */
  people: string[];
  /** The repository's milestones, open and closed, for the Milestone filter; without any there is no filter. */
  milestones?: PlanMilestone[] | undefined;
  /** The tasks in no milestone, for No milestone's count. */
  noMilestone?: MilestoneTasks | undefined;
};

/**
 * The Milestone filter: All milestones, the open milestones with their due dates and tasks done, No milestone, and
 * the closed milestones under Closed.
 */
function MilestoneFilter({ filters, milestones, noMilestone, go }: { filters: Filters; milestones: PlanMilestone[]; noMilestone: MilestoneTasks | undefined; go: (next: Partial<Filters>) => void }) {
  const [open, setOpen] = useState(false);
  const choose = (milestone: Filters["milestone"]) => {
    setOpen(false);
    go({ milestone });
  };
  const openOnes = milestones.filter((m) => m.state === "open");
  const closed = milestones.filter((m) => m.state === "closed");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FilterButton name="Milestone" value={filters.milestone === undefined ? undefined : milestoneLabel(milestones, filters.milestone)} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Find a milestone" />
          <CommandList>
            <CommandEmpty>No milestone matches.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="all milestones" data-checked={filters.milestone === undefined ? "true" : undefined} onSelect={() => choose(undefined)}>
                All milestones
              </CommandItem>
              {openOnes.map((m) => (
                <CommandItem key={m.number} value={`${m.title} #${m.number}`} data-checked={filters.milestone === m.number ? "true" : undefined} onSelect={() => choose(m.number)}>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{m.title}</span>
                    <span className="text-xs text-muted-foreground">{dueText(m)}</span>
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {m.progress.done} of {m.progress.total} done
                  </span>
                </CommandItem>
              ))}
              <CommandItem value="no milestone" data-checked={filters.milestone === "none" ? "true" : undefined} onSelect={() => choose("none")}>
                <span className="flex-1">No milestone</span>
                <span className="text-xs text-muted-foreground tabular-nums">{noMilestone ? noMilestone.total - noMilestone.done : 0} open</span>
              </CommandItem>
            </CommandGroup>
            {closed.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Closed">
                  {closed.map((m) => (
                    <CommandItem key={m.number} value={`${m.title} #${m.number} closed`} data-checked={filters.milestone === m.number ? "true" : undefined} onSelect={() => choose(m.number)}>
                      <span className="min-w-0 flex-1 truncate">{m.title}</span>
                      <span className="text-xs text-muted-foreground">{dueText(m)}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** The Plan page's filters: Epic, Status, Run, Assignee and Milestone. Every choice lives in the URL, so a link or a refresh keeps it. */
export function PlanFilters({ projectId, view, filters, epics, counts, unplanned, me, people, milestones, noMilestone }: Props) {
  const router = useRouter();
  const [epicOpen, setEpicOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const go = (next: Partial<Filters>) => router.replace(planPath(projectId, { view, ...filters, ...next }), { scroll: false });
  const toggleStatus = (status: PlanStatus) =>
    go({ status: filters.status.includes(status) ? filters.status.filter((s) => s !== status) : PLAN_STATUSES.filter((s) => s === status || filters.status.includes(s)) });
  const assignees = [{ value: "anyone", label: "Anyone" }, ...(me ? [{ value: "me", label: "Me" }] : []), { value: "none", label: "Unassigned" }, ...people.map((p) => ({ value: p, label: p }))];

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Popover open={epicOpen} onOpenChange={setEpicOpen}>
        <PopoverTrigger asChild>
          <FilterButton name="Epic" value={filters.epic === undefined ? undefined : epicLabel(epics, filters.epic)} />
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
          <FilterButton name="Status" value={filters.status.length === 0 ? undefined : filters.status.join(", ")} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuGroup>
            {PLAN_STATUSES.map((status) => (
              <DropdownMenuCheckboxItem key={status} checked={filters.status.includes(status)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggleStatus(status)}>
                <span aria-hidden className={cn("size-2 rounded-full", COLUMN_TONE[status].dot)} />
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
          <FilterButton name="Run" value={filters.run === "any" ? undefined : RUN_LABEL[filters.run]} />
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

      <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
        <PopoverTrigger asChild>
          <FilterButton name="Assignee" value={filters.assignee === "anyone" ? undefined : assigneeLabel(filters.assignee)} />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-60">
          <RadioGroup
            value={filters.assignee}
            aria-label="Assignee"
            onValueChange={(assignee) => {
              setAssigneeOpen(false);
              go({ assignee });
            }}
          >
            {assignees.map((a) => (
              <Field key={a.value} orientation="horizontal">
                <RadioGroupItem value={a.value} id={`plan-assignee-${a.value}`} />
                <FieldLabel htmlFor={`plan-assignee-${a.value}`} className={cn(a.value === a.label && "font-mono text-xs")}>
                  {a.label}
                </FieldLabel>
              </Field>
            ))}
          </RadioGroup>
        </PopoverContent>
      </Popover>

      {milestones && milestones.length > 0 && <MilestoneFilter filters={filters} milestones={milestones} noMilestone={noMilestone} go={go} />}
    </div>
  );
}

/** With a filter set, a chip per filter that undoes it, and Clear filters for all of them; the search stays. */
export function FilterChips({ projectId, view, filters, epics, milestones }: Pick<Props, "projectId" | "view" | "filters" | "epics" | "milestones">) {
  const href = (next: Partial<Filters>) => planPath(projectId, { view, ...filters, ...next });
  const chips = [
    filters.epic !== undefined && { label: `Epic: ${epicLabel(epics, filters.epic)}`, href: href({ epic: undefined }) },
    filters.status.length > 0 && { label: `Status: ${filters.status.join(", ")}`, href: href({ status: [] }) },
    filters.run !== "any" && { label: `Run: ${RUN_LABEL[filters.run]}`, href: href({ run: "any" }) },
    filters.assignee !== "anyone" && { label: `Assignee: ${assigneeLabel(filters.assignee)}`, href: href({ assignee: "anyone" }) },
    filters.milestone !== undefined && { label: `Milestone: ${milestoneLabel(milestones, filters.milestone)}`, href: href({ milestone: undefined }) },
  ].filter((c): c is { label: string; href: string } => Boolean(c));
  if (chips.length === 0) return null;
  return (
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
        <Link href={planPath(projectId, { view, q: filters.q })} scroll={false} replace>
          Clear filters
        </Link>
      </Button>
    </div>
  );
}
