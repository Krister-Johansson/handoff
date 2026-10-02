"use client";

import { useState, useTransition, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightIcon, CalendarIcon, ListTreeIcon, PlayIcon, Undo2Icon } from "lucide-react";
import { moveToReadyAction, moveToShapingAction, planIssueAction } from "@/app/projects/actions";
import { startIssueRunAction } from "@/app/projects/issue-actions";
import type { StoryChoice } from "@/components/plan/plan-actions";
import { ScheduleDialog, type ScheduleTarget } from "@/components/plan/schedule-dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { runPath } from "@/lib/paths";
import type { Move } from "@/lib/plan/task";

type Issue = { number: number; title: string };

const MOVES: Record<Move, { label: string; icon: ComponentType; action: typeof moveToReadyAction; text: string }> = {
  ready: { label: "Move to Ready", icon: ArrowRightIcon, action: moveToReadyAction, text: "Its Status on GitHub becomes Ready and it joins the backlog." },
  shaping: { label: "Back to Shaping", icon: Undo2Icon, action: moveToShapingAction, text: "Its Status on GitHub becomes Shaping and it leaves the backlog until it is Ready again." },
};

/** A move on the plan, asked first: the title names the task, and the move happens only on the confirm button. */
export function MoveButton({ move, issue, projectId }: { move: Move; issue: Issue; projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const { label, icon: Icon, action, text } = MOVES[move];
  const confirm = () =>
    startTransition(async () => {
      const result = await action({ projectId, issue: issue.number });
      if (result.error) return setError(result.error);
      setOpen(false);
      router.refresh();
    });
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(undefined);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline">
          <Icon data-icon="inline-start" />
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Move #{issue.number} {issue.title} {move === "ready" ? "to Ready" : "back to Shaping"}?
          </AlertDialogTitle>
          <AlertDialogDescription>{text}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && <FieldError>{error}</FieldError>}
        <AlertDialogFooter>
          <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
          <Button type="button" disabled={pending} onClick={confirm}>
            {label}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Schedule: the Plan's dialog for Start and Target, opened from the header. */
export function ScheduleButton({ item, projectId }: { item: ScheduleTarget; projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <CalendarIcon data-icon="inline-start" />
        Schedule
      </Button>
      <ScheduleDialog
        projectId={projectId}
        item={open ? item : undefined}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) router.refresh();
        }}
      />
    </>
  );
}

/**
 * A dialog that asks before an action: the trigger, a title and a line, the fields of a form, and the
 * action's button. `onSubmit` gets the form's values and returns GitHub's refusal, or nothing when done.
 */
function FormDialog({
  trigger,
  title,
  description,
  submit,
  onSubmit,
  children,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  submit: string;
  onSubmit: (form: FormData) => Promise<string | undefined>;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(undefined);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          className="contents"
          action={(form) =>
            startTransition(async () => {
              const refused = await onSubmit(form);
              if (refused) setError(refused);
              else setOpen(false);
            })
          }
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {children}
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Plan it: adds an issue outside the plan to it as a task in Shaping, under a story when one is picked. */
export function PlanItButton({ issue, projectId, stories }: { issue: Issue; projectId: string; stories: StoryChoice[] }) {
  const router = useRouter();
  const epics = [...new Set(stories.map((s) => s.epic))];
  const plan = async (form: FormData) => {
    const story = Number(form.get("story"));
    const result = await planIssueAction({ projectId, issue: issue.number, ...(story ? { story } : {}) });
    if (result.error) return result.error;
    router.refresh();
    return undefined;
  };
  return (
    <FormDialog
      trigger={
        <Button variant="outline">
          <ListTreeIcon data-icon="inline-start" />
          Plan it
        </Button>
      }
      title={`Plan #${issue.number} ${issue.title}`}
      description="Adds it to the plan as a task in Shaping."
      submit="Plan it"
      onSubmit={plan}
    >
      <Field>
        <FieldLabel htmlFor={`plan-it-${issue.number}`}>Story (optional)</FieldLabel>
        <NativeSelect id={`plan-it-${issue.number}`} name="story" defaultValue="">
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
      </Field>
    </FormDialog>
  );
}

/**
 * Start run from the issue's page: a run of the chosen graph on this issue. The page stays, and the
 * toast says when the start assigned the issue to you because nobody had it.
 */
export function StartRunButton({ issue, projectId, graphs, graphName }: { issue: Issue; projectId: string; graphs: string[]; graphName: string }) {
  const router = useRouter();
  const start = async (form: FormData) => {
    const result = await startIssueRunAction({ projectId, issue: issue.number, graphName: String(form.get("graph") ?? graphName) });
    if (!result.ok) return result.error;
    toast.success("Run started", {
      ...(result.assigned ? { description: `#${issue.number} had no assignee, so it is assigned to you.` } : {}),
      action: { label: "Open run", onClick: () => router.push(runPath(projectId, result.runId)) },
    });
    router.refresh();
    return undefined;
  };
  return (
    <FormDialog
      trigger={
        <Button>
          <PlayIcon data-icon="inline-start" />
          Start run
        </Button>
      }
      title={`Start a run on #${issue.number} ${issue.title}`}
      description="Runs the latest saved version of the graph with this issue linked. If nobody is assigned the issue, it is assigned to you."
      submit="Start run"
      onSubmit={start}
    >
      {graphs.length > 1 ? (
        <Field>
          <FieldLabel htmlFor={`start-graph-${issue.number}`}>Graph</FieldLabel>
          <NativeSelect id={`start-graph-${issue.number}`} name="graph" defaultValue={graphName}>
            {graphs.map((g) => (
              <NativeSelectOption key={g} value={g}>
                {g}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      ) : (
        <input type="hidden" name="graph" value={graphName} />
      )}
    </FormDialog>
  );
}

/** Show in the plan: the Plan tree narrowed to the epic the item belongs to. */
export function ShowInPlan({ href }: { href: string }) {
  return (
    <Button variant="outline" asChild>
      <Link href={href}>
        <ListTreeIcon data-icon="inline-start" />
        Show in the plan
      </Link>
    </Button>
  );
}
