"use client";

import { useActionState, useEffect } from "react";
import { DEFAULT_UI_PATHS } from "@handoff/core";
import { deleteProjectAction, updateProjectAction, type ActionState } from "@/app/projects/actions";
import { Button } from "@/components/ui/button";
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** What the edit and delete dialogs show of a project. */
export type ProjectSummary = {
  id: string;
  name: string;
  repoOwner: string;
  repoName: string;
  defaultBranch: string;
  runCount: number;
  setupCommand?: string | null;
  teardownCommand?: string | null;
  agentNotes?: string | null;
  demoSeedCommand?: string | null;
  uiPaths?: string[] | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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
              <FieldDescription>
                Runs once in each run&apos;s worktree before its first step there, for example to install dependencies. It sees HANDOFF_RUN_ID, HANDOFF_RUN_SHORT and
                HANDOFF_WORKTREE, so it can name a test database per run. Leave it empty to run nothing.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={`edit-teardown-${project.id}`}>Teardown command</FieldLabel>
              <Input
                id={`edit-teardown-${project.id}`}
                name="teardownCommand"
                className="font-mono"
                placeholder="dropdb --if-exists app_test_$HANDOFF_RUN_SHORT"
                defaultValue={state.values?.teardownCommand ?? project.teardownCommand ?? ""}
              />
              <FieldDescription>Runs in the worktree just before handoff removes it, to drop what the setup command made for the run.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={`edit-notes-${project.id}`}>Agent notes</FieldLabel>
              <Textarea
                id={`edit-notes-${project.id}`}
                name="agentNotes"
                rows={3}
                placeholder="The database container is shared and already running."
                defaultValue={state.values?.agentNotes ?? project.agentNotes ?? ""}
              />
              <FieldDescription>Every agent step reads these facts about the project&apos;s environment. Do not put secrets here: the notes are stored as plain text.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={`edit-seed-${project.id}`}>Demo seed command</FieldLabel>
              <Input
                id={`edit-seed-${project.id}`}
                name="demoSeedCommand"
                className="font-mono"
                placeholder="pnpm db:seed"
                defaultValue={state.values?.demoSeedCommand ?? project.demoSeedCommand ?? ""}
              />
              <FieldDescription>Runs in the worktree before a demo starts the app, after the services in the compose file are up, so the demo has data to show.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={`edit-ui-paths-${project.id}`}>UI paths</FieldLabel>
              <Textarea
                id={`edit-ui-paths-${project.id}`}
                name="uiPaths"
                rows={3}
                className="font-mono"
                placeholder="apps/web/**"
                defaultValue={state.values?.uiPaths ?? project.uiPaths?.join("\n") ?? ""}
              />
              <FieldDescription>
                Globs, one a line, of the files a person sees in the app. A demo set to UI changes skips a change that touches none of them. Empty means{" "}
                <span className="font-mono">{DEFAULT_UI_PATHS.join(" ")}</span>.
              </FieldDescription>
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

/** Asks before deleting a project, says what goes and what stays, and shows a refusal. */
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
