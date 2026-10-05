"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRightLeftIcon, CheckIcon, ExternalLinkIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { unlinkPlanAction } from "@/app/projects/actions";
import { SetUpPlanDialog } from "@/components/plan/set-up-plan-dialog";
import { AddFieldsButton } from "@/components/projects/add-fields";
import { AddProjectDialog } from "@/components/projects/add-project-dialog";
import { DeleteProjectDialog, EditProjectDialog } from "@/components/projects/project-dialogs";
import { RepositoryMovedDialog } from "@/components/projects/repository-moved";
import { ProjectTile } from "@/components/project-switcher";
import { SchedulerRowTag } from "@/components/scheduler/scheduler-badge";
import { SectionCard } from "@/components/section-card";
import { Tag } from "@/components/tag";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
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
import { FieldError } from "@/components/ui/field";
import { MODE_FIELDS } from "@/lib/plan/plan-fields";
import type { PlanModeName } from "@/lib/project-tab";
import { projectSettingsPath, projectSettingsTabLabel } from "@/lib/settings-tab";
import type { PlanFieldsPresent, PlanLink } from "@/server/project-admin";
import type { SchedulerBrief } from "@/server/scheduler-card";

/** A project as Settings, Projects lists it. */
export type ProjectRow = {
  id: string;
  name: string;
  repoOwner: string;
  repoName: string;
  defaultBranch: string;
  setupCommand: string | null;
  teardownCommand?: string | null;
  agentNotes?: string | null;
  demoSeedCommand?: string | null;
  uiPaths?: string[] | null;
  isDemo: boolean;
  /** How the project plans: a Flow project has sizes and no dates or estimates. */
  planMode: PlanModeName;
  runCount: number;
  plan: PlanLink | null;
  /** The scheduler's state and active runs of max runs, while it is on. */
  scheduler?: SchedulerBrief | undefined;
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const MONO = "font-mono text-xs leading-5";
const NONE = <span className="text-[13px] text-muted-foreground">none</span>;

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** Asks before forgetting the plan's GitHub Project; the Project stays on GitHub. */
function UnlinkPlanDialog({ project, plan }: { project: ProjectRow; plan: PlanLink }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const planName = plan.title ?? `GitHub Project #${plan.number}`;
  const unlink = () =>
    startTransition(async () => {
      const result = await unlinkPlanAction({ projectId: project.id });
      if (result.error) setError(result.error);
      else setOpen(false);
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
        <Button size="xs" variant="ghost">
          Unlink
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Unlink {planName} from {project.name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            handoff stops reading the plan and stops writing status. The backlog goes back to every open issue. The Project, its items and the labels stay on GitHub.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <FieldError>{error}</FieldError>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={pending} onClick={unlink}>
            Unlink
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The fields handoff reads, as each reads present or missing. */
const FIELDS: { key: keyof PlanFieldsPresent; present: string; missing: string }[] = [
  { key: "start", present: "Start", missing: "No Start field" },
  { key: "target", present: "Target", missing: "No Target field" },
  { key: "size", present: "Size: S, M, L", missing: "No Size field" },
  { key: "estimate", present: "Estimate, Number", missing: "No Estimate field" },
];

/**
 * The Project's fields that the plan mode reads, and Add the fields when any is missing: in a Timeline project
 * it adds the date fields and the Size and Estimate fields the Project lacks; in a Flow project, Size only, as
 * setup_plan does.
 */
function PlanFields({ projectId, mode, fields }: { projectId: string; mode: PlanModeName; fields: PlanFieldsPresent }) {
  return (
    <div className="mt-1.5 flex flex-col items-start gap-1.5">
      <ul aria-label="Fields" className="flex flex-wrap gap-1">
        {FIELDS.filter(({ key }) => MODE_FIELDS[mode].has(key)).map(({ key, present, missing }) => (
          <li key={key}>
            {fields[key] ? (
              <Tag tone="success">
                <CheckIcon aria-hidden />
                {present}
              </Tag>
            ) : (
              <Tag className="border-dashed">{missing}</Tag>
            )}
          </li>
        ))}
      </ul>
      <AddFieldsButton projectId={projectId} mode={mode} fields={fields} />
    </div>
  );
}

/** The plan's GitHub Project with its link and fields, or Set up the plan when there is none. */
function PlanOnGitHub({ project }: { project: ProjectRow }) {
  const { plan } = project;
  if (!plan) {
    if (project.isDemo) return NONE;
    return (
      <div className="flex flex-col items-start gap-2">
        <span className="text-[13px] text-muted-foreground">No GitHub Project holds a plan for {project.name} yet.</span>
        <SetUpPlanDialog size="sm" project={{ id: project.id, name: project.name, repo: `${project.repoOwner}/${project.repoName}` }} />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-0.5 text-[13px]">
      <span className="flex items-center gap-1.5">
        {plan.url ? (
          <a href={plan.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline underline-offset-3">
            {plan.title}
            <ExternalLinkIcon aria-hidden className="size-3 text-muted-foreground" />
          </a>
        ) : null}
        <span className="font-mono text-xs text-muted-foreground">#{plan.number}</span>
      </span>
      {plan.url ? (
        <span className="text-muted-foreground">{plan.url.replace(/^https:\/\//, "")}</span>
      ) : (
        <span className="text-muted-foreground">GitHub cannot be read with GITHUB_TOKEN, so the Project&apos;s name is missing.</span>
      )}
      {plan.fields && <PlanFields projectId={project.id} mode={project.planMode} fields={plan.fields} />}
      <div className="mt-1.5">
        <UnlinkPlanDialog project={project} plan={plan} />
      </div>
    </div>
  );
}

/**
 * What Settings, Projects manages for one project: name, repository, default branch, setup and teardown commands, agent notes, demo settings and plan,
 * and where its estimates are: capacity, forecasts and the plan budget, or in a Flow project the plan budget only.
 */
function ProjectDetails({ project }: { project: ProjectRow }) {
  const section = projectSettingsTabLabel("estimates", project.planMode);
  return (
    <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
      <Detail term="Name">
        <span className={MONO}>{project.name}</span>
      </Detail>
      <Detail term="Repository">
        <span className={MONO}>
          {project.repoOwner}/{project.repoName}
        </span>
      </Detail>
      <Detail term="Default branch">
        <span className={MONO}>{project.defaultBranch}</span>
      </Detail>
      <Detail term="Setup command">{project.setupCommand ? <span className={`${MONO} break-all`}>{project.setupCommand}</span> : NONE}</Detail>
      <Detail term="Teardown command">{project.teardownCommand ? <span className={`${MONO} break-all`}>{project.teardownCommand}</span> : NONE}</Detail>
      <Detail term="Agent notes">{project.agentNotes ? <p className="whitespace-pre-wrap break-words">{project.agentNotes}</p> : NONE}</Detail>
      <Detail term="Demo seed command">{project.demoSeedCommand ? <span className={`${MONO} break-all`}>{project.demoSeedCommand}</span> : NONE}</Detail>
      <Detail term="UI paths">
        {project.uiPaths?.length ? (
          <span className={`${MONO} break-all`}>{project.uiPaths.join(" ")}</span>
        ) : (
          <span className="text-[13px] text-muted-foreground">the defaults: routes, pages, components and styles</span>
        )}
      </Detail>
      <Detail term="Plan on GitHub">
        <PlanOnGitHub project={project} />
      </Detail>
      <Detail term={section}>
        <span className="text-[13px] text-muted-foreground">
          {project.planMode === "flow" ? "The plan budget is in" : "Capacity, forecasts and the plan budget are in"}{" "}
          <Link href={projectSettingsPath(project.id, "estimates")} className="font-medium text-foreground underline underline-offset-3">
            Project settings, {section}
          </Link>
          .
        </span>
      </Detail>
    </dl>
  );
}

/** Edit, Repository moved and Delete for the open project; Delete asks first. The demo project points at no repository to move. */
function ProjectActions({ project }: { project: ProjectRow }) {
  const [dialog, setDialog] = useState<"edit" | "moved" | "delete">();
  const close = (next: boolean) => !next && setDialog(undefined);
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={() => setDialog("edit")}>
        <PencilIcon data-icon="inline-start" />
        Edit
      </Button>
      {!project.isDemo && (
        <>
          <Button size="sm" variant="outline" onClick={() => setDialog("moved")}>
            <ArrowRightLeftIcon data-icon="inline-start" />
            Repository moved
          </Button>
          <RepositoryMovedDialog
            project={{ ...project, schedulerOn: Boolean(project.scheduler && project.scheduler.state !== "paused") }}
            open={dialog === "moved"}
            onOpenChange={close}
          />
        </>
      )}
      <Button size="sm" variant="outline" className="text-danger hover:bg-danger-bg hover:text-danger" onClick={() => setDialog("delete")}>
        <Trash2Icon data-icon="inline-start" />
        Delete
      </Button>
      <EditProjectDialog project={project} open={dialog === "edit"} onOpenChange={close} />
      <DeleteProjectDialog project={project} open={dialog === "delete"} onOpenChange={close} />
    </div>
  );
}

/**
 * Settings, Projects: every project as a row, one open at a time with what is managed here, and Add
 * project. `adding` opens the add form on arrival.
 */
export function ProjectsSettings({ projects, adding = false }: { projects: ProjectRow[]; adding?: boolean }) {
  const [open, setOpen] = useState("");
  return (
    <SectionCard
      title="Projects"
      description="A project is a GitHub repository with its graphs and runs."
      action={<AddProjectDialog size="sm" defaultOpen={adding} />}
      className="max-w-[760px]"
    >
      <Accordion type="single" collapsible value={open} onValueChange={setOpen} className="border-t">
        {projects.map((project) => (
          <AccordionItem key={project.id} value={project.id} className="data-[state=open]:bg-subtle">
            <AccordionTrigger aria-label={`${open === project.id ? "Hide" : "Show"} ${project.name}`} className="items-center gap-3 rounded-none px-5 py-3 hover:no-underline">
              <ProjectTile name={project.name} />
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate font-semibold">{project.name}</span>
                <span className="truncate font-mono text-xs font-normal text-muted-foreground">
                  {project.repoOwner}/{project.repoName}
                </span>
              </span>
              {project.scheduler && <SchedulerRowTag brief={project.scheduler} />}
              <Tag>{plural(project.runCount, "run")}</Tag>
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-4 pt-1 pr-5 pb-4 pl-16">
              <ProjectDetails project={project} />
              <ProjectActions project={project} />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </SectionCard>
  );
}
