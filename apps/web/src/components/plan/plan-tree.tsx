"use client";

import { createContext, useContext, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRightIcon, ChevronsDownUpIcon, CircleDotIcon, ExternalLinkIcon, LockIcon, MoreHorizontalIcon } from "lucide-react";
import type { PlanEpic, PlanStory, PlanTask } from "@/server/plan";
import type { BacklogIssue } from "@/server/backlog";
import { StatusBadge } from "@/components/runs/status-badge";
import { BlockedRunButton, StartRunDialog } from "@/components/projects/forms";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tag } from "@/components/tag";
import { runPath } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { PlanItDialog, TaskActions, type StartRunContext, type StoryChoice } from "./plan-actions";
import { KindBadge, ProgressBar, StatusPill } from "./plan-status";
import { taskColumn } from "@/lib/plan/task";
import { AssigneeButton } from "./assignee-button";
import { BlockedChip, IssueTitle, PrLink, RunCell, TaskTags } from "./plan-task-parts";

import { matchesQuery } from "@/lib/plan/search";
import { useSearchQuery } from "./plan-context";
import { useRowsOpen } from "./use-collapsed";

type Props = StartRunContext & {
  projectId: string;
  repoUrl: string;
  epics: PlanEpic[];
  unparented: PlanTask[];
  unplanned: BacklogIssue[];
  /** Ids of runs that wait on a person: a question, a permission request or a failed step. */
  needsYou: string[];
  /** Why the latest status write for an issue was skipped, by issue number, as summarizeEvent words it. */
  skipped?: Record<number, string>;
  /** Per epic, how many of its tasks the filters or the search hide. */
  hidden?: Record<number, number>;
  /** What hides them, for the line under the epic. */
  hiddenBy?: "filters" | "search" | "filters and search";
  /** During a search, the rows it opens; the collapse store's rows otherwise. */
  searchOpen?: Set<string> | undefined;
};

type RowContext = StartRunContext & Pick<Props, "projectId" | "repoUrl" | "needsYou" | "skipped">;

/** The row that holds the tree's one tab stop. */
const ActiveRow = createContext<string | undefined>(undefined);

const INDENT = { 1: "pl-3", 2: "pl-8", 3: "pl-[52px]" } as const;

/**
 * One row of the tree and, when it is open, the rows under it. The row is the treeitem's first child,
 * so focus lights the row alone.
 */
function TreeRow({
  id,
  level,
  label,
  expanded,
  head,
  match,
  children,
  group,
}: {
  id: string;
  level: 1 | 2 | 3;
  label: string;
  expanded?: boolean;
  head?: boolean;
  /** Whether the search found this row. */
  match?: boolean;
  children: ReactNode;
  group?: ReactNode;
}) {
  const active = useContext(ActiveRow);
  return (
    <li
      role="treeitem"
      data-key={id}
      tabIndex={active === id ? 0 : -1}
      // Selection follows focus: the row with the tab stop is the selected one.
      aria-selected={active === id}
      aria-level={level}
      aria-label={label}
      aria-expanded={expanded}
      data-match={match || undefined}
      className="outline-none [&:focus-visible>[data-row]]:ring-2 [&:focus-visible>[data-row]]:ring-ring [&:focus-visible>[data-row]]:ring-inset"
    >
      <div
        data-row
        className={cn("flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b py-1.5 pr-3 hover:bg-muted/60", INDENT[level], head && "bg-muted/50")}
      >
        {children}
      </div>
      {expanded && group && <ul role="group">{group}</ul>}
    </li>
  );
}

function Chevron({ expanded, onToggle, label }: { expanded: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
      onClick={onToggle}
      className="-ml-1 flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <ChevronRightIcon aria-hidden className={cn("size-4 transition-transform", expanded && "rotate-90")} />
    </button>
  );
}

const LEFT = "flex min-w-0 flex-1 basis-64 items-center gap-2.5";
/** A task row's left side wraps its chips under the title when they leave the title no room. */
const TASK_LEFT = "flex min-w-0 flex-1 basis-64 flex-wrap items-center gap-x-2.5 gap-y-1";
const RIGHT = "ml-auto flex shrink-0 items-center gap-3";

function TaskRow({ task, outside, ...ctx }: { task: PlanTask; outside?: boolean } & RowContext) {
  const column = taskColumn(task);
  const q = useSearchQuery();
  return (
    <TreeRow id={`t${task.number}`} level={outside ? 2 : 3} label={`Task #${task.number} ${task.title}, ${column}`} match={matchesQuery(task, q)}>
      <span className={TASK_LEFT}>
        <span className="flex max-w-full min-w-0 items-center gap-2.5">
          <StatusPill column={column} spinning={column === "Running" && task.run?.status === "running"} />
          <IssueTitle item={task} />
        </span>

        <TaskTags task={task} skipped={ctx.skipped?.[task.number]} />
        {outside && task.parent !== undefined && <Tag>parent #{task.parent} is not in the plan</Tag>}
        {column !== "Done" && <BlockedChip blockedBy={task.blockedBy} repoUrl={ctx.repoUrl} />}
      </span>
      <span className={RIGHT}>
        <RunCell task={task} projectId={ctx.projectId} needsYou={ctx.needsYou} />
        <PrLink task={task} repoUrl={ctx.repoUrl} />
        <span className="flex min-w-6 justify-center empty:hidden">
          <AssigneeButton task={task} />
        </span>
        <TaskActions task={task} projectId={ctx.projectId} start={ctx} />
      </span>
    </TreeRow>
  );
}

function StoryRow({ story, expanded, onToggle, ...ctx }: { story: PlanStory; expanded: boolean; onToggle: () => void } & RowContext) {
  const label = `Story #${story.number} ${story.title}`;
  const q = useSearchQuery();
  return (
    <TreeRow
      id={`s${story.number}`}
      level={2}
      label={label}
      expanded={expanded}
      match={matchesQuery(story, q)}
      group={story.tasks.map((t) => (
        <TaskRow key={t.number} task={t} {...ctx} />
      ))}
    >
      <span className={LEFT}>
        <Chevron expanded={expanded} onToggle={onToggle} label={label} />
        <KindBadge kind="story" />
        <IssueTitle item={story} className="font-medium" />
        {story.tasks.some((t) => taskColumn(t) !== "Done" && t.blockedBy.length > 0) && (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <LockIcon aria-hidden className="size-3" />
            Blocked
          </span>
        )}
      </span>
      <span className={RIGHT}>
        <ProgressBar progress={story.progress} />
        <span className="w-6" />
      </span>
    </TreeRow>
  );
}

function EpicMenu({ epic, onCollapseStories }: { epic: PlanEpic; onCollapseStories: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label={`Actions for epic #${epic.number}`}>
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <a href={epic.url}>
              <ExternalLinkIcon />
              Open on GitHub
            </a>
          </DropdownMenuItem>
          {epic.stories.length > 0 && (
            <DropdownMenuItem onSelect={onCollapseStories}>
              <ChevronsDownUpIcon />
              Collapse all stories
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A block of the tree with a heading row of its own: an epic, Unparented or Unplanned. */
function Block({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-lg border bg-card [&_li:last-child>[data-row]:last-child]:border-b-0">{children}</div>;
}

function UnplannedRow({ issue, projectId, start, stories }: { issue: BacklogIssue; projectId: string; start: StartRunContext; stories: StoryChoice[] }) {
  const run = issue.run && issue.run.status !== "cancelled" ? issue.run : undefined;
  const q = useSearchQuery();
  return (
    <TreeRow id={`u${issue.number}`} level={2} label={`Issue #${issue.number} ${issue.title}`} match={matchesQuery(issue, q)}>
      <span className={LEFT}>
        <CircleDotIcon aria-hidden className="size-3.5 shrink-0 text-success-dot" />
        <span className="w-10 shrink-0 text-xs text-muted-foreground">issue</span>
        <IssueTitle item={issue} />
      </span>
      <span className={RIGHT}>
        <PlanItDialog issue={issue} projectId={projectId} stories={stories} />
        {run ? (
          <Link href={runPath(projectId, run.id)} className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <StatusBadge status={run.status} />
          </Link>
        ) : issue.blockedBy.length > 0 ? (
          <BlockedRunButton label="Start run" reason={`Blocked by ${issue.blockedBy.map((n) => `#${n}`).join(", ")} on GitHub; it can start once they are closed`} />
        ) : (
          start.graphName !== undefined && (
            <StartRunDialog projectId={projectId} graphs={start.graphs} graphName={start.graphName} label="Start run" variant="outline" initialIssues={[issue]} />
          )
        )}
      </span>
    </TreeRow>
  );
}

/** Focus moves between the visible rows the way a tree's does: arrows, Home and End; Enter opens the issue. */
function useTreeKeys(toggle: (key: string, open?: boolean) => void) {
  const [active, setActive] = useState<string>();
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const item = e.target as HTMLElement;
    if (item.getAttribute("role") !== "treeitem") return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=treeitem]")];
    const at = items.indexOf(item);
    const expanded = item.getAttribute("aria-expanded");
    const go = (el: HTMLElement | null | undefined) => el?.focus();
    const keys: Record<string, () => void> = {
      ArrowDown: () => go(items[at + 1]),
      ArrowUp: () => go(items[at - 1]),
      Home: () => go(items[0]),
      End: () => go(items.at(-1)),
      ArrowRight: () => (expanded === "false" ? toggle(item.dataset.key!, true) : expanded === "true" && go(item.querySelector<HTMLElement>("[role=group] > [role=treeitem]"))),
      ArrowLeft: () => (expanded === "true" ? toggle(item.dataset.key!, false) : go(item.parentElement?.closest<HTMLElement>("[role=treeitem]"))),
      Enter: () => item.querySelector<HTMLAnchorElement>(":scope > [data-row] a[data-title]")?.click(),
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  };
  const onFocus = (e: FocusEvent<HTMLUListElement>) => {
    const target = e.target as HTMLElement;
    if (target.getAttribute("role") === "treeitem" && target.dataset.key) setActive(target.dataset.key);
  };
  return { active, onKeyDown, onFocus };
}

/**
 * The plan as a tree: epic blocks with their progress, their stories, and the tasks with status, run,
 * pull request and the moves handoff owns. Unparented items and unplanned issues follow in blocks of
 * their own. Collapsed epics and stories are remembered in this browser.
 */
export function PlanTree({ epics, unparented, unplanned, hidden, hiddenBy = "filters", searchOpen, ...ctx }: Props) {
  const rows = useRowsOpen(ctx.projectId, searchOpen);
  const { collapsed } = rows;
  const q = useSearchQuery();
  const { active, onKeyDown, onFocus } = useTreeKeys(rows.toggle);
  const open = rows.isOpen;
  const stories = epics.flatMap((e) => e.stories.map((s) => ({ number: s.number, title: s.title, epic: e.title })));
  const first = epics[0] ? `e${epics[0].number}` : unparented.length ? "unparented" : "unplanned";
  return (
    <ActiveRow value={active ?? first}>
      <ul role="tree" aria-label="Plan" className="flex flex-col gap-3" onKeyDown={onKeyDown} onFocus={onFocus}>
        {epics.map((epic) => {
          const key = `e${epic.number}`;
          const label = `Epic #${epic.number} ${epic.title}`;
          const more = hidden?.[epic.number] ?? 0;
          return (
            <Block key={epic.number}>
              <TreeRow
                id={key}
                level={1}
                head
                label={label}
                expanded={open(key)}
                match={matchesQuery(epic, q)}
                group={
                  <>
                    {epic.stories.map((s) => (
                      <StoryRow key={s.number} story={s} expanded={open(`s${s.number}`)} onToggle={() => rows.toggle(`s${s.number}`)} {...ctx} />
                    ))}
                    {epic.tasks.map((t) => (
                      <TaskRow key={t.number} task={t} {...ctx} />
                    ))}
                    {more > 0 && (
                      <li role="none" className="px-3 py-2 text-xs text-muted-foreground">
                        {more === 1 ? `1 more task in this epic does not match the ${hiddenBy}.` : `${more} more tasks in this epic do not match the ${hiddenBy}.`}
                      </li>
                    )}
                  </>
                }
              >
                <span className={LEFT}>
                  <Chevron expanded={open(key)} onToggle={() => rows.toggle(key)} label={label} />
                  <KindBadge kind="epic" />
                  <IssueTitle item={epic} className="text-sm font-semibold" />
                </span>
                <span className={RIGHT}>
                  <ProgressBar progress={epic.progress} />
                  <EpicMenu epic={epic} onCollapseStories={() => collapsed.collapseAll(epic.stories.map((s) => `s${s.number}`))} />
                </span>
              </TreeRow>
            </Block>
          );
        })}
        {unparented.length > 0 && (
          <Block>
            <TreeRow
              id="unparented"
              level={1}
              head
              label={`Unparented, ${unparented.length}`}
              expanded={open("unparented")}
              group={unparented.map((t) => (
                <TaskRow key={t.number} task={t} outside {...ctx} />
              ))}
            >
              <span className={LEFT}>
                <Chevron expanded={open("unparented")} onToggle={() => rows.toggle("unparented")} label="Unparented" />
                <span className="text-sm font-semibold">Unparented</span>
                <Tag tone="fill">{unparented.length}</Tag>
                <span className="text-xs text-muted-foreground">In the plan, with no epic or story of the plan above it.</span>
              </span>
            </TreeRow>
          </Block>
        )}
        {unplanned.length > 0 && (
          <Block>
            <TreeRow
              id="unplanned"
              level={1}
              head
              label={`Unplanned, ${unplanned.length}`}
              expanded={open("unplanned")}
              group={unplanned.map((issue) => (
                <UnplannedRow key={issue.number} issue={issue} projectId={ctx.projectId} start={ctx} stories={stories} />
              ))}
            >
              <span className={LEFT}>
                <Chevron expanded={open("unplanned")} onToggle={() => rows.toggle("unplanned")}
 label="Unplanned" />
                <span className="text-sm font-semibold">Unplanned</span>
                <Tag tone="fill">{unplanned.length}</Tag>
                <span className="text-xs text-muted-foreground">Open issues outside the plan. They stay startable.</span>
              </span>
            </TreeRow>
          </Block>
        )}
      </ul>
    </ActiveRow>
  );
}
