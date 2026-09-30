"use client";

import { useActionState, useState, useTransition, type KeyboardEvent } from "react";
import type { IssueSummary } from "@handoff/github";
import { MoreHorizontalIcon, PlayIcon, PlusIcon } from "lucide-react";
import { createGraphAction, deleteGraphAction, renameGraphAction, startRunAction, listIssuesAction, type ActionState } from "@/app/projects/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { IssuePicker } from "./issue-picker";

export function NewGraphDialog({ projectId, templates }: { projectId: string; templates: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState(createGraphAction, {} as ActionState);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon data-icon="inline-start" />
          New graph
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={action} className="contents">
          <DialogHeader>
            <DialogTitle>New graph</DialogTitle>
            <DialogDescription>Start from a template and edit it in the graph editor.</DialogDescription>
          </DialogHeader>
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
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Create graph
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function submitOnModEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

/**
 * Starts a run of one graph. With `graphs`, the dialog lets you pick which graph runs; `graphName`
 * is then the preselected one.
 */
export function StartRunDialog({
  projectId,
  graphName,
  graphs,
  label = "Run",
  size = "sm",
}: {
  projectId: string;
  graphName: string;
  graphs?: string[];
  label?: string;
  size?: "sm" | "default";
}) {
  const [state, action, pending] = useActionState(startRunAction, {} as ActionState);
  const [issues, setIssues] = useState<{ issues: IssueSummary[] } | { error: string }>();
  const [linked, setLinked] = useState<IssueSummary[]>([]);
  const [loadingIssues, startLoadingIssues] = useTransition();
  const onOpenChange = (open: boolean) => {
    if (open && !issues) startLoadingIssues(async () => setIssues(await listIssuesAction(projectId)));
  };
  return (
    <Dialog onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size={size} variant={graphs ? "default" : "outline"}>
          <PlayIcon data-icon="inline-start" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action} className="contents">
          <DialogHeader>
            <DialogTitle>Start a run</DialogTitle>
            <DialogDescription>
              {graphs ? (
                "Runs the latest saved version of the chosen graph against the project repository."
              ) : (
                <>
                  Runs the latest saved version of <span className="font-mono">{graphName}</span> against the project repository.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="projectId" value={projectId} />
          {!graphs && <input type="hidden" name="graphName" value={graphName} />}
          <FieldGroup>
            {graphs && (
              <Field>
                <FieldLabel htmlFor="run-graph">Graph</FieldLabel>
                <NativeSelect id="run-graph" name="graphName" defaultValue={state.values?.graphName ?? graphName}>
                  {graphs.map((g) => (
                    <NativeSelectOption key={g} value={g}>
                      {g}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="run-issues">Issues</FieldLabel>
              {loadingIssues || !issues ? (
                <Skeleton className="h-9 w-full" />
              ) : "issues" in issues ? (
                <IssuePicker issues={issues.issues} value={linked} onChange={setLinked} />
              ) : (
                <FieldDescription>{issues.error}</FieldDescription>
              )}
            </Field>
            <Field data-invalid={state.error ? true : undefined}>
              <FieldLabel htmlFor="run-task">Task</FieldLabel>
              <Textarea
                id="run-task"
                name="task"
                rows={5}
                className="max-h-[40dvh]"
                placeholder={linked.length ? "Optional: what to do about the linked issues. Empty uses their titles." : "Add a CHANGELOG.md with today's date"}
                defaultValue={state.values?.task}
                onKeyDown={submitOnModEnter}
              />
              <FieldDescription>
                The Planner reads this and the linked issues first; be as specific as you would with a colleague. Cmd or Ctrl+Enter starts the run.
              </FieldDescription>
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
