"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRightIcon, ExternalLinkIcon, MoreHorizontalIcon, PlayIcon, Undo2Icon, WrenchIcon } from "lucide-react";
import { moveToReadyAction, moveToShapingAction, planIssueAction } from "@/app/projects/actions";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import type { PlanTask } from "@/server/plan";
import { BlockedRunButton, StartRunDialog } from "@/components/projects/forms";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldError } from "@/components/ui/field";
import { runPath } from "@/lib/paths";
import { hasActiveRun, movesOf, taskColumn, type Move } from "@/lib/plan/task";

const MOVE = {
  ready: { label: "Move to Ready", icon: ArrowRightIcon, action: moveToReadyAction, title: (t: PlanTask) => `Move #${t.number} ${t.title} to Ready?` },
  shaping: { label: "Back to Shaping", icon: Undo2Icon, action: moveToShapingAction, title: (t: PlanTask) => `Move #${t.number} ${t.title} back to Shaping?` },
} as const;

function moveText(move: Move, task: PlanTask) {
  if (move === "shaping") return "Its Status on GitHub becomes Shaping and it leaves the backlog until it is Ready again.";
  const blockers = task.blockedBy.map((n) => `#${n}`).join(", ");
  return `Its Status on GitHub becomes Ready and it joins the backlog.${blockers ? ` It is blocked by ${blockers}, so a run can start once ${task.blockedBy.length > 1 ? "they are" : "it is"} closed.` : ""}`;
}

/** Asks before a move: the title names the task, and the move happens only on the confirm button. */
function MoveDialog({ move, task, projectId, onOpenChange }: { move: Move | undefined; task: PlanTask; projectId: string; onOpenChange: (open: boolean) => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const close = (open: boolean) => {
    if (!open) setError(undefined);
    onOpenChange(open);
  };
  const shown = move ?? "ready";
  const confirm = () =>
    startTransition(async () => {
      const result = await MOVE[shown].action({ projectId, issue: task.number });
      if (result.error) setError(result.error);
      else close(false);
    });
  return (
    <AlertDialog open={move !== undefined} onOpenChange={close}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{MOVE[shown].title(task)}</AlertDialogTitle>
          <AlertDialogDescription>{moveText(shown, task)}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && <FieldError>{error}</FieldError>}
        <AlertDialogFooter>
          <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
          <Button type="button" disabled={pending} onClick={confirm}>
            {MOVE[shown].label}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export type StartRunContext = { graphs: string[]; graphName: string | undefined };

/** A story an unplanned issue can go under, with its epic for the picker's groups. */
export type StoryChoice = { number: number; title: string; epic: string };

/** Plan it: adds an open issue outside the plan as a task in Shaping, under a story when one is picked. */
export function PlanItDialog({ issue, projectId, stories }: { issue: { number: number; title: string }; projectId: string; stories: StoryChoice[] }) {
  const [open, setOpen] = useState(false);
  const [story, setStory] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const epics = [...new Set(stories.map((s) => s.epic))];
  const confirm = () =>
    startTransition(async () => {
      const result = await planIssueAction({ projectId, issue: issue.number, ...(story ? { story: Number(story) } : {}) });
      if (result.error) setError(result.error);
      else setOpen(false);
    });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(undefined);
      }}
    >
      <DialogTrigger asChild>
        <Button size="xs" variant="ghost">
          Plan it
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Plan #{issue.number} {issue.title}
          </DialogTitle>
          <DialogDescription>Adds it to the plan as a task in Shaping.</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor={`plan-it-${issue.number}`}>Story (optional)</FieldLabel>
          <NativeSelect id={`plan-it-${issue.number}`} value={story} onChange={(e) => setStory(e.target.value)}>
            <NativeSelectOption value="">No story</NativeSelectOption>
            {epics.map((epic) => (
              <NativeSelectOptGroup key={epic} label={epic}>
                {stories
                  .filter((s) => s.epic === epic)
                  .map((s) => (
                    <NativeSelectOption key={s.number} value={String(s.number)}>
                      #{s.number} {s.title}
                    </NativeSelectOption>
                  ))}
              </NativeSelectOptGroup>
            ))}
          </NativeSelect>
          <FieldDescription>Put it under a story now, or later on GitHub.</FieldDescription>
          {error && <FieldError>{error}</FieldError>}
        </Field>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button disabled={pending} onClick={confirm}>
            Plan it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A task's actions: the moves its status allows as buttons, Start run on a Ready task, Repair on a
 * failed run, and the menu with the same moves, Open on GitHub and Open run. `compact` keeps only the
 * menu, as on a board card.
 */
export function TaskActions({ task, projectId, start, compact }: { task: PlanTask; projectId: string; start: StartRunContext; compact?: boolean }) {
  const [move, setMove] = useState<Move>();
  const moves = movesOf(task);
  const column = taskColumn(task);
  const startable = column === "Ready" && !hasActiveRun(task) && start.graphName !== undefined;
  const failed = task.run?.status === "failed";
  return (
    <span className="flex shrink-0 items-center justify-end gap-1.5">
      {!compact && (
        <>
          {moves.map((m) => (
            <Button key={m} size="xs" variant={m === "ready" && column === "Shaping" ? "outline" : "ghost"} onClick={() => setMove(m)}>
              {MOVE[m].label}
            </Button>
          ))}
          {column === "Ready" && hasActiveRun(task) && <span className="text-xs text-muted-foreground">Run active</span>}
          {startable &&
            (task.blockedBy.length > 0 ? (
              <BlockedRunButton label="Start run" reason={`Blocked by ${task.blockedBy.map((n) => `#${n}`).join(", ")} on GitHub; it can start once they are closed`} />
            ) : (
              <StartRunDialog
                projectId={projectId}
                graphs={start.graphs}
                graphName={start.graphName!}
                label="Start run"
                variant="outline"
                initialIssues={[{ number: task.number, title: task.title, url: task.url, labels: task.labels, author: null, updatedAt: task.updatedAt, blockedBy: task.blockedBy }]}
              />
            ))}
          {failed && task.run && (
            <Button size="xs" variant="outline" asChild>
              <Link href={runPath(projectId, task.run.id)}>
                <WrenchIcon data-icon="inline-start" />
                Repair
              </Link>
            </Button>
          )}
        </>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-xs" variant="ghost" aria-label={`Actions for #${task.number}`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <a href={task.url}>
                <ExternalLinkIcon />
                Open on GitHub
              </a>
            </DropdownMenuItem>
            {task.run && (
              <DropdownMenuItem asChild>
                <Link href={runPath(projectId, task.run.id)}>
                  <PlayIcon />
                  Open run
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">{task.run.id.slice(0, 8)}</span>
                </Link>
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          {moves.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {moves.map((m) => {
                  const Icon = MOVE[m].icon;
                  return (
                    <DropdownMenuItem key={m} onSelect={() => setMove(m)}>
                      <Icon />
                      {MOVE[m].label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <MoveDialog move={move} task={task} projectId={projectId} onOpenChange={(open) => !open && setMove(undefined)} />
    </span>
  );
}
