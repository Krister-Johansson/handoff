"use client";

import { useState, useTransition } from "react";
import { CopyIcon, KeyRoundIcon, LayersIcon, SearchXIcon, SquareKanbanIcon } from "lucide-react";
import { listGitHubProjectsAction, setupPlanAction, type GitHubProjectChoice } from "@/app/projects/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { ShapeButton } from "./shape-button";

type Project = { id: string; name: string; repo: string };

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
 * the choice when there are none.
 */
function SetUpPlanDialog({ project }: { project: Project }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [choices, setChoices] = useState<GitHubProjectChoice[]>();
  const [choice, setChoice] = useState<string>(NEW);
  const onOpenChange = (open: boolean) => {
    setError(undefined);
    if (!open || choices) return;
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
    });
  const detail = (p: GitHubProjectChoice) =>
    p.missing_status_options.length ? `#${p.number} · Renames or adds ${listed(p.missing_status_options)}` : `#${p.number} · Status options match`;
  const linked = choices?.filter((p) => p.linked) ?? [];
  const others = choices?.filter((p) => !p.linked) ?? [];
  return (
    <Dialog onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>Set up the plan</Button>
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
            {others.length > 0 && <p className="px-2 pt-1 text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase">Other Projects you own</p>}
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

function Command({ text }: { text: string }) {
  return (
    <div className="flex w-full items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-2.5 py-1.5 text-left font-mono text-xs">{text}</code>
      <Button size="icon-sm" variant="outline" aria-label={`Copy ${text}`} onClick={() => void navigator.clipboard?.writeText(text)}>
        <CopyIcon />
      </Button>
    </div>
  );
}

export type PlanEmptyReason = "no-plan" | "no-scope" | "unreachable" | "empty";

/**
 * In place of the tree or the board when there is nothing to show: no plan yet, a token that cannot
 * reach GitHub Projects, a Project handoff cannot read, or a plan with nothing shaped in it.
 */
export function PlanEmpty({ reason, project, error }: { reason: PlanEmptyReason; project: Project; error?: string }) {
  return (
    <Empty className="rounded-lg border py-12">
      {reason === "no-plan" && (
        <>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SquareKanbanIcon />
            </EmptyMedia>
            <EmptyTitle>No plan on GitHub yet</EmptyTitle>
            <EmptyDescription>
              handoff can create a GitHub Project for this repository with the columns Shaping, Ready, Running, In review and Done, and the labels epic, story and task.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <SetUpPlanDialog project={project} />
          </EmptyContent>
        </>
      )}
      {reason === "no-scope" && (
        <>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRoundIcon />
            </EmptyMedia>
            <EmptyTitle>GitHub Projects need the project scope</EmptyTitle>
            <EmptyDescription>
              The token in GITHUB_TOKEN cannot reach your Projects. Add the scope to the GitHub CLI login, then give the dashboard the new token and restart it.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="max-w-sm gap-2">
            <Command text="gh auth refresh -s project" />
            <span className="text-xs text-muted-foreground">then</span>
            <Command text="GITHUB_TOKEN=$(gh auth token)" />
          </EmptyContent>
        </>
      )}
      {reason === "unreachable" && (
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon />
          </EmptyMedia>
          <EmptyTitle>The plan&apos;s Project cannot be read</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
      )}
      {reason === "empty" && (
        <>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayersIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing shaped yet</EmptyTitle>
            <EmptyDescription>Shape the first epic with the assistant or from Claude Code: an epic with its goal, stories with acceptance criteria, then tasks.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <ShapeButton projectName={project.name} />
          </EmptyContent>
        </>
      )}
    </Empty>
  );
}
