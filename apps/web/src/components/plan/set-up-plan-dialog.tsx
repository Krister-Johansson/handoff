"use client";

import { useState, useTransition } from "react";
import { listGitHubProjectsAction, setupPlanAction, type GitHubProjectChoice } from "@/app/projects/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";

/** The handoff project the plan is for, with its repository as owner/name. */
export type PlanProjectRef = { id: string; name: string; repo: string };

const NEW = "new";

/** "Shaping, Ready and Running" from a list of Status options. */
const listed = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : (items[0] ?? ""));

function ProjectChoice({ value, title, detail }: { value: string; title: string; detail: string }) {
  const id = `setup-plan-${value}`;
  return (
    <Field orientation="horizontal" className="rounded-md px-2 py-1.5 has-data-checked:bg-muted">
      <RadioGroupItem value={value} id={id} />
      <FieldContent>
        <FieldLabel htmlFor={id}>{title}</FieldLabel>
        <FieldDescription className="text-xs">{detail}</FieldDescription>
      </FieldContent>
    </Field>
  );
}

/**
 * Asks which GitHub Project holds the plan before handoff writes anything: the person's Projects
 * linked to the repository first, then their other Projects, then Create a new Project, which is
 * the choice when there are none. The Plan page and Settings, Projects both open it; it closes once
 * the plan is set up.
 */
export function SetUpPlanDialog({ project, size = "default" }: { project: PlanProjectRef; size?: "sm" | "default" }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [choices, setChoices] = useState<GitHubProjectChoice[]>();
  const [choice, setChoice] = useState<string>(NEW);
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    setError(undefined);
    if (!next || choices) return;
    startTransition(async () => {
      const result = await listGitHubProjectsAction(project.id);
      if ("error" in result) return setError(result.error);
      setChoices(result.projects);
      const linked = result.projects.find((p) => p.linked);
      if (linked) setChoice(String(linked.number));
    });
  };
  const confirm = () =>
    startTransition(async () => {
      const result = await setupPlanAction(choice === NEW ? { projectId: project.id } : { projectId: project.id, use: Number(choice) });
      if (result.error) setError(result.error);
      else setOpen(false);
    });
  const detail = (p: GitHubProjectChoice) =>
    p.missing_status_options.length ? `#${p.number} · Renames or adds ${listed(p.missing_status_options)}` : `#${p.number} · Status options match`;
  const linked = choices?.filter((p) => p.linked) ?? [];
  const others = choices?.filter((p) => !p.linked) ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size={size}>Set up the plan</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set up the plan</DialogTitle>
          <DialogDescription>
            Choose the GitHub Project that holds the plan for {project.name}. handoff renames its Status options to Shaping, Ready, Running, In review and Done, and adds
            the labels epic, story and task to the repository.
          </DialogDescription>
        </DialogHeader>
        {choices === undefined && pending ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <RadioGroup value={choice} onValueChange={setChoice} aria-label="GitHub Project" className="max-h-80 gap-1 overflow-y-auto rounded-md border p-1.5">
            {linked.length > 0 && <p className="px-2 pt-1 text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase">Linked to {project.repo}</p>}
            {linked.map((p) => (
              <ProjectChoice key={p.number} value={String(p.number)} title={p.title} detail={detail(p)} />
            ))}
            {others.length > 0 && <p className="px-2 pt-1 text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase">Other Projects of {project.repo.split("/")[0]}</p>}
            {others.map((p) => (
              <ProjectChoice key={p.number} value={String(p.number)} title={p.title} detail={detail(p)} />
            ))}
            <ProjectChoice value={NEW} title="Create a new Project" detail={`"${project.name} plan", linked to ${project.repo}`} />
          </RadioGroup>
        )}
        {error && <FieldError>{error}</FieldError>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button disabled={pending} onClick={confirm}>
            {choice === NEW ? "Create a new Project" : "Use this Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
