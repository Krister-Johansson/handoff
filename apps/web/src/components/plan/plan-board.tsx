"use client";

import { useState } from "react";
import { ExternalLinkIcon, MoreHorizontalIcon, MoveIcon } from "lucide-react";
import type { PlanProject } from "@handoff/github";
import type { PlanColumn, PlanEpic, PlanTask } from "@/server/plan";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { StartRunContext } from "./plan-actions";
import { PlanCard } from "./plan-card";
import { COLUMN_TONE } from "@/lib/plan/task";

const COLUMNS: PlanColumn[] = ["Shaping", "Ready", "Running", "In review", "Done", "Other"];
const EMPTY: Partial<Record<PlanColumn, string>> = {
  Ready: "Move tasks here when they are shaped. Only Ready tasks reach the backlog.",
  Running: "Start a run from a Ready task.",
};
const DAY = 24 * 60 * 60 * 1000;
const DONE_WINDOW = 30 * DAY;

/** Each task's eyebrow: the title of the epic it sits under, or the parent outside the plan. */
function eyebrows(epics: PlanEpic[]): (task: PlanTask) => string | undefined {
  const byTask = new Map<number, string>();
  for (const epic of epics) for (const t of [...epic.stories.flatMap((s) => s.tasks), ...epic.tasks]) byTask.set(t.number, epic.title);
  return (task) => byTask.get(task.number) ?? (task.parent !== undefined ? `parent #${task.parent} is not in the plan` : undefined);
}

function ColumnMenu({ column, project }: { column: PlanColumn; project: PlanProject }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label={`${column} column`}>
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex gap-2 text-xs font-normal text-muted-foreground">
          <MoveIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          Drag cards on GitHub. This board shows the Project; it does not move cards.
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <a href={project.url}>
              <ExternalLinkIcon />
              Open {project.title} on GitHub
            </a>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The plan's tasks in one column per Status. A view, not an editor: cards open the issue, the run badge
 * opens the run, and the card menu has the tree's actions. Done shows the last 30 days until Show all.
 * Other appears only when a task sits in a Status option handoff does not know.
 */
export function PlanBoard({
  board,
  epics,
  project,
  projectId,
  repoUrl,
  needsYou,
  skipped,
  now,
  ...start
}: StartRunContext & {
  board: Record<PlanColumn, PlanTask[]>;
  epics: PlanEpic[];
  project: PlanProject;
  projectId: string;
  repoUrl: string;
  needsYou: string[];
  skipped?: Record<number, string>;
  /** The time the page was read, for the Done column's 30 days. */
  now: number;
}) {
  const [showAllDone, setShowAllDone] = useState(false);
  const eyebrowOf = eyebrows(epics);
  const doneAll = board.Done.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const doneRecent = doneAll.filter((t) => now - Date.parse(t.updatedAt) <= DONE_WINDOW);
  const columns = COLUMNS.filter((c) => c !== "Other" || board.Other.length > 0);
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-2">
      <div className="grid min-w-[1060px] auto-cols-fr grid-flow-col gap-3">
        {columns.map((column) => {
          const tasks = column === "Done" ? (showAllDone ? doneAll : doneRecent) : board[column];
          const hiddenDone = column === "Done" && !showAllDone && doneRecent.length < doneAll.length;
          return (
            <section key={column} aria-label={column} className="flex min-h-80 flex-col gap-2 rounded-lg border bg-muted/40 p-2">
              <header className="flex items-center gap-2 px-1 pt-0.5">
                <span aria-hidden className={cn("size-2 rounded-full", COLUMN_TONE[column].dot)} />
                <h3 className="text-[13px] font-semibold">{column}</h3>
                <span className="text-xs text-muted-foreground tabular-nums">{board[column].length}</span>
                <span className="ml-auto">
                  <ColumnMenu column={column} project={project} />
                </span>
              </header>
              {tasks.length === 0 && EMPTY[column] ? (
                <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">{EMPTY[column]}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {tasks.map((task) => (
                    <PlanCard
                      key={task.number}
                      task={task}
                      eyebrow={eyebrowOf(task)}
                      projectId={projectId}
                      repoUrl={repoUrl}
                      needsYou={needsYou}
                      skipped={skipped?.[task.number]}
                      start={start}
                    />
                  ))}
                </ul>
              )}
              {hiddenDone && (
                <div className="mt-auto flex items-center justify-between px-1 text-xs text-muted-foreground">
                  <span>
                    Last 30 days, {doneRecent.length} of {doneAll.length}
                  </span>
                  <Button size="xs" variant="link" className="h-auto px-0" onClick={() => setShowAllDone(true)}>
                    Show all
                  </Button>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
