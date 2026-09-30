"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { deleteProjectAction, updateProjectAction, type ActionState } from "@/app/projects/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { runFilterHref } from "@/lib/run-filter";
import { cn } from "@/lib/utils";
import type { ProjectAttention } from "@/server/project-admin";

export type ProjectSummary = { id: string; name: string; repoOwner: string; repoName: string; defaultBranch: string; isDemo: boolean; runCount: number };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ATTENTION_LINK = "relative z-10 rounded-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** Closes a dialog once its action reports success. */
function useCloseOnSuccess(state: ActionState, onOpenChange: (open: boolean) => void) {
  useEffect(() => {
    if (state.ok) onOpenChange(false);
  }, [state, onOpenChange]);
}

export function EditProjectDialog({ project, open, onOpenChange }: { project: ProjectSummary; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [state, action, pending] = useActionState(updateProjectAction, {} as ActionState);
  useCloseOnSuccess(state, onOpenChange);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form action={action} className="contents">
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
            <DialogDescription>
              <span className="font-mono">
                {project.repoOwner}/{project.repoName}
              </span>
              . The CLI refers to the project by its name.
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="projectId" value={project.id} />
          <FieldGroup>
            <Field data-invalid={state.error ? true : undefined}>
              <FieldLabel htmlFor={`edit-name-${project.id}`}>Name</FieldLabel>
              <Input id={`edit-name-${project.id}`} name="name" defaultValue={state.values?.name ?? project.name} />
            </Field>
            <Field>
              <FieldLabel htmlFor={`edit-branch-${project.id}`}>Default branch</FieldLabel>
              <Input id={`edit-branch-${project.id}`} name="defaultBranch" defaultValue={state.values?.defaultBranch ?? project.defaultBranch} />
            </Field>
            {state.error && <FieldError>{state.error}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteProjectDialog({ project, open, onOpenChange }: { project: ProjectSummary; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [state, action, pending] = useActionState(deleteProjectAction, {} as ActionState);
  useCloseOnSuccess(state, onOpenChange);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <form action={action} className="contents">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {project.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the project, its graphs and the history of its {plural(project.runCount, "run")} from handoff. The repository and its pull requests on
              GitHub stay as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input type="hidden" name="projectId" value={project.id} />
          {state.error && <FieldError>{state.error}</FieldError>}
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Keep it</AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={pending}>
              Delete project
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ProjectMenu({ project }: { project: ProjectSummary }) {
  const [open, setOpen] = useState<"edit" | "delete">();
  const close = (next: boolean) => !next && setOpen(undefined);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${project.name}`} className="relative z-10">
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setOpen("edit")}>
            <PencilIcon />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setOpen("delete")}>
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <EditProjectDialog project={project} open={open === "edit"} onOpenChange={close} />
      <DeleteProjectDialog project={project} open={open === "delete"} onOpenChange={close} />
    </>
  );
}

/** A project with what it needs from the user (questions, failed runs, reviews) and what it is busy with. */
export function ProjectCard({ project, attention }: { project: ProjectSummary; attention: ProjectAttention }) {
  const needsYou = attention.questions + attention.failed + attention.reviews > 0;
  return (
    <Card className={cn("relative h-full transition-colors hover:bg-muted/50", needsYou && "border-amber-500/60 dark:border-amber-400/50")}>
      <CardHeader>
        <CardTitle>
          <Link href={`/projects/${project.id}`} className="rounded-sm after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring">
            {project.name}
          </Link>
        </CardTitle>
        <CardDescription className="font-mono text-xs">
          {project.repoOwner}/{project.repoName} · {project.defaultBranch}
        </CardDescription>
        <CardAction>
          <ProjectMenu project={project} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {needsYou && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-sm text-amber-900 dark:text-amber-200">
            <span className="font-medium">Needs you</span>
            {attention.questions > 0 && (
              <Link href="/inbox" className={ATTENTION_LINK}>
                {plural(attention.questions, "question")}
              </Link>
            )}
            {attention.failed > 0 && (
              <Link href={runFilterHref({}, { status: "failed", project: project.name })} className={ATTENTION_LINK}>
                {plural(attention.failed, "failed run")}
              </Link>
            )}
            {attention.reviews > 0 && (
              <Link href={`/projects/${project.id}`} className={ATTENTION_LINK}>
                {plural(attention.reviews, "PR to review", "PRs to review")}
              </Link>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{plural(project.runCount, "run")}</Badge>
          {project.isDemo && <Badge variant="secondary">demo</Badge>}
          {attention.running > 0 && <Badge variant="secondary">{attention.running} running</Badge>}
          {attention.waitingOnCi > 0 && <Badge variant="outline">{attention.waitingOnCi} waiting on CI</Badge>}
        </div>
      </CardContent>
    </Card>
  );
}
