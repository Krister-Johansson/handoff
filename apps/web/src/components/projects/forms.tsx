"use client";

import { useActionState } from "react";
import { MoreHorizontalIcon, PlayIcon } from "lucide-react";
import { createGraphAction, createProjectAction, deleteGraphAction, renameGraphAction, startRunAction, type ActionState } from "@/app/projects/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

export function NewProjectForm() {
  const [state, action, pending] = useActionState(createProjectAction, {} as ActionState);
  return (
    <form action={action}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="project-name">Name</FieldLabel>
          <Input id="project-name" name="name" placeholder="sandbox" defaultValue={state.values?.name} />
        </Field>
        <Field>
          <FieldLabel htmlFor="project-repo">GitHub repository</FieldLabel>
          <Input id="project-repo" name="repo" placeholder="owner/name" defaultValue={state.values?.repo} />
        </Field>
        <Field>
          <FieldLabel htmlFor="project-branch">Default branch</FieldLabel>
          <Input id="project-branch" name="defaultBranch" placeholder="main" defaultValue={state.values?.defaultBranch} />
        </Field>
        {state.error && <FieldError>{state.error}</FieldError>}
        <Button type="submit" disabled={pending}>
          Add project
        </Button>
      </FieldGroup>
    </form>
  );
}

export function NewGraphForm({ projectId, templates }: { projectId: string; templates: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState(createGraphAction, {} as ActionState);
  return (
    <form action={action}>
      <input type="hidden" name="projectId" value={projectId} />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="graph-name">Name</FieldLabel>
          <Input id="graph-name" name="name" placeholder="main" defaultValue={state.values?.name} />
        </Field>
        <Field>
          <FieldLabel htmlFor="graph-template">Start from</FieldLabel>
          <NativeSelect id="graph-template" name="template" defaultValue={state.values?.template ?? "loop"}>
            {templates.map((t) => (
              <NativeSelectOption key={t.value} value={t.value}>
                {t.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        {state.error && <FieldError>{state.error}</FieldError>}
        <Button type="submit" disabled={pending}>
          Create graph
        </Button>
      </FieldGroup>
    </form>
  );
}

export function StartRunDialog({ projectId, graphName, size = "sm" }: { projectId: string; graphName: string; size?: "sm" | "default" }) {
  const [state, action, pending] = useActionState(startRunAction, {} as ActionState);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size={size} variant="outline">
          <PlayIcon data-icon="inline-start" />
          Run
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action} className="contents">
          <DialogHeader>
            <DialogTitle>Start a run</DialogTitle>
            <DialogDescription>
              Runs the latest saved version of <span className="font-mono">{graphName}</span> against the project repository.
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="graphName" value={graphName} />
          <FieldGroup>
            <Field data-invalid={state.error ? true : undefined}>
              <FieldLabel htmlFor="run-task">Task</FieldLabel>
              <Textarea id="run-task" name="task" rows={5} placeholder="Add a CHANGELOG.md with today's date" defaultValue={state.values?.task} />
              <FieldDescription>The Planner reads this first; be as specific as you would with a colleague.</FieldDescription>
              {state.error && <FieldError>{state.error}</FieldError>}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Start run
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Rename or delete a graph. Delete is refused while runs are pinned to its versions. */
export function GraphSettingsDialog({ projectId, graphName }: { projectId: string; graphName: string }) {
  const [renameState, rename, renaming] = useActionState(renameGraphAction, {} as ActionState);
  const [deleteState, remove, deleting] = useActionState(deleteGraphAction, {} as ActionState);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`Settings for ${graphName}`}>
          <MoreHorizontalIcon />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Graph settings</DialogTitle>
          <DialogDescription>
            Rename <span className="font-mono">{graphName}</span>, or delete it if no run has used it.
          </DialogDescription>
        </DialogHeader>
        <form action={rename}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="from" value={graphName} />
          <FieldGroup>
            <Field data-invalid={renameState.error ? true : undefined}>
              <FieldLabel htmlFor={`rename-${graphName}`}>New name</FieldLabel>
              <Input id={`rename-${graphName}`} name="to" defaultValue={renameState.values?.to ?? graphName} />
              {renameState.error && <FieldError>{renameState.error}</FieldError>}
            </Field>
            <Button type="submit" disabled={renaming}>
              Rename
            </Button>
          </FieldGroup>
        </form>
        <form action={remove}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="name" value={graphName} />
          <FieldGroup>
            {deleteState.error && <FieldError>{deleteState.error}</FieldError>}
            <Button type="submit" variant="destructive" disabled={deleting}>
              Delete graph
            </Button>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
