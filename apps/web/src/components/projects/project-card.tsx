"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useState } from "react";
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { deleteProjectAction, updateProjectAction, type ActionState } from "@/app/projects/actions";
import { StatusBadge } from "@/components/runs/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatAgo } from "@/lib/format";
import { runPath } from "@/lib/paths";
import { cn } from "@/lib/utils";
import type { ProjectAttention } from "@/server/project-admin";
import { Tag } from "@/components/tag";

export type ProjectSummary = {
  id: string;
  name: string;
  repoOwner: string;
  repoName: string;
  defaultBranch: string;
  isDemo: boolean;
  runCount: number;
  /** Queued, running and waiting runs; the card counts the ones not queued or running as waiting. */
  activeRuns?: number;
  setupCommand?: string | null;
};

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
            <Field>
              <FieldLabel htmlFor={`edit-setup-${project.id}`}>Setup command</FieldLabel>
              <Input
                id={`edit-setup-${project.id}`}
                name="setupCommand"
                className="font-mono"
                placeholder="pnpm install --frozen-lockfile"
                defaultValue={state.values?.setupCommand ?? project.setupCommand ?? ""}
              />
              <FieldDescription>Runs once in each run&apos;s worktree before its first step there, for example to install dependencies. Leave it empty to run nothing.</FieldDescription>
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

export function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
  onDeleted,
}: {
  project: ProjectSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const [state, action, pending] = useActionState(deleteProjectAction, {} as ActionState);
  useCloseOnSuccess(state, onOpenChange);
  useEffect(() => {
    if (state.ok) onDeleted?.();
  }, [state, onDeleted]);
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

/** Edit and Delete as buttons, for the project page's Settings tab; deleting leaves for the projects list. */
export function ProjectSettingsActions({ project }: { project: ProjectSummary }) {
  const [open, setOpen] = useState<"edit" | "delete">();
  const router = useRouter();
  const close = (next: boolean) => !next && setOpen(undefined);
  const toProjects = useCallback(() => router.push("/projects"), [router]);
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" onClick={() => setOpen("edit")}>
        <PencilIcon data-icon="inline-start" />
        Edit
      </Button>
      <Button size="sm" variant="outline" className="text-danger hover:bg-danger-bg hover:text-danger" onClick={() => setOpen("delete")}>
        <Trash2Icon data-icon="inline-start" />
        Delete
      </Button>
      <EditProjectDialog project={project} open={open === "edit"} onOpenChange={close} />
      <DeleteProjectDialog project={project} open={open === "delete"} onOpenChange={close} onDeleted={toProjects} />
    </div>
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

/** A project's newest run, shown at the foot of its card. */
export type LatestRun = { id: string; task: string; status: string; createdAt: Date };

/** A project with what it needs from the user (questions, failed runs, reviews), what it is busy with and its newest run. */
export function ProjectCard({ project, attention, latest, now = new Date() }: { project: ProjectSummary; attention: ProjectAttention; latest?: LatestRun; now?: Date }) {
  const needsYou = attention.questions + attention.failed + attention.reviews > 0;
  const waiting = Math.max(0, (project.activeRuns ?? 0) - attention.running);
  return (
    <Card className={cn("relative h-full gap-3.5 px-5 py-[18px] transition-colors hover:bg-muted/50", needsYou && "ring-attention-dot/45")}>
      <div className="flex min-w-0 flex-col gap-0.5 pr-8">
        <Link
          href={`/projects/${project.id}`}
          data-voice-phrase={project.name}
          className="truncate rounded-sm text-[15px] font-semibold underline-offset-3 after:absolute after:inset-0 after:rounded-xl hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
        >
          {project.name}
        </Link>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {project.repoOwner}/{project.repoName} · {project.defaultBranch}
        </span>
      </div>
      <div className="absolute top-3 right-3">
        <ProjectMenu project={project} />
      </div>
      <div className="flex flex-col gap-3">
        {needsYou ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-attention-bg px-2.5 py-2 text-[13px]">
            <span className="font-medium text-attention">Needs you</span>
            {attention.questions > 0 && (
              <Link href="/inbox" className={ATTENTION_LINK}>
                {plural(attention.questions, "question")}
              </Link>
            )}
            {attention.failed > 0 && (
              <Link href="/inbox" className={ATTENTION_LINK}>
                {plural(attention.failed, "failed run")}
              </Link>
            )}
            {attention.reviews > 0 && (
              <Link href={`/projects/${project.id}/pulls`} className={ATTENTION_LINK}>
                {plural(attention.reviews, "PR to review", "PRs to review")}
              </Link>
            )}
          </div>
        ) : (
          <div className="rounded-md bg-subtle px-2.5 py-2 text-[13px] text-muted-foreground">Nothing needs you.</div>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Tag>{plural(project.runCount, "run")}</Tag>
          {project.isDemo && <Tag tone="fill">demo</Tag>}
          {attention.running > 0 && <Tag tone="active">{attention.running} running</Tag>}
          {waiting > 0 && <Tag tone="attention">{waiting} waiting</Tag>}
          {attention.waitingOnCi > 0 && <Tag>{attention.waitingOnCi} waiting on CI</Tag>}
        </div>
      </div>
      {latest && (
        <div className="mt-auto flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <StatusBadge status={latest.status} />
          <Link href={runPath(project.id, latest.id)} className={cn(ATTENTION_LINK, "min-w-0 truncate")}>
            {latest.task}
          </Link>
          <span className="ml-auto shrink-0" title={latest.createdAt.toISOString()}>
            {formatAgo(latest.createdAt, now)}
          </span>
        </div>
      )}
    </Card>
  );
}
