"use client";

import { useActionState, useEffect, useState } from "react";
import { moveProjectAction, type ActionState } from "@/app/projects/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/** What the Repository moved dialog shows of a project: its repository, the plan's Project and whether the scheduler is on. */
export type MovedProjectSummary = {
  id: string;
  name: string;
  repoOwner: string;
  repoName: string;
  plan: { number: number } | null;
  schedulerOn: boolean;
};

const REPO = /^[^/\s]+\/[^/\s]+$/;

/** What moving to `repo` changes, as the dialog says it once `repo` looks like owner/name. */
function changes(project: MovedProjectSummary, repo: string): string {
  const ownerChanged = repo.split("/")[0]!.toLowerCase() !== project.repoOwner.toLowerCase();
  return [
    `handoff will use ${repo} for this project's runs.`,
    ...(ownerChanged && project.plan ? [`The plan's GitHub Project belongs to ${project.repoOwner}, so it is unlinked; set up the plan again.`] : []),
    ...(ownerChanged && project.schedulerOn ? ["The scheduler pauses."] : []),
  ].join(" ");
}

/**
 * Points a project at its repository's new place after GitHub moved it, for example to an organization. Says what
 * changes as the person types the new owner/name; Save moves the project, and a refusal shows in the dialog.
 */
export function RepositoryMovedDialog({ project, open, onOpenChange }: { project: MovedProjectSummary; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [state, action, pending] = useActionState(moveProjectAction, {} as ActionState);
  const [repo, setRepo] = useState("");
  useEffect(() => {
    if (state.ok) onOpenChange(false);
  }, [state, onOpenChange]);
  const typed = repo.trim();
  const id = `moved-repo-${project.id}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form action={action} className="contents">
          <DialogHeader>
            <DialogTitle>Repository moved</DialogTitle>
            <DialogDescription>
              GitHub moved{" "}
              <span className="font-mono">
                {project.repoOwner}/{project.repoName}
              </span>
              ? Give its new owner and name. Runs, graphs and pins stay with {project.name}.
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="projectId" value={project.id} />
          <FieldGroup>
            <Field data-invalid={state.error ? true : undefined}>
              <FieldLabel htmlFor={id}>New repository</FieldLabel>
              <Input id={id} name="repo" className="font-mono" placeholder="owner/name" autoComplete="off" value={repo} onChange={(e) => setRepo(e.target.value)} />
              {REPO.test(typed) && <FieldDescription>{changes(project, typed)}</FieldDescription>}
            </Field>
            {state.error && <FieldError>{state.error}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending || !REPO.test(typed)}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
