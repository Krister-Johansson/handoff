"use client";

import { useId, useState, useTransition } from "react";
import { CpuIcon, ListTreeIcon, PowerIcon } from "lucide-react";
import { saveSchedulerAction, turnOffSchedulerAction } from "@/app/projects/scheduler-actions";
import { SetUpPlanDialog } from "@/components/plan/set-up-plan-dialog";
import { CARD_BODY, SectionCard } from "@/components/section-card";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SchedulerCard } from "@/server/scheduler-card";
import { SchedulerBadge } from "./scheduler-badge";
import { PauseButton, ResumeButton, type SchedulerProject } from "./scheduler-card";
import { approvalSentence, initialValues, type SchedulerFormContext, type SchedulerValues } from "@/lib/scheduler-form";
import { SchedulerFields } from "./scheduler-fields";

const DESCRIPTION = "Starts runs on the plan's Ready tasks on its own, up to a limit, while nothing waits on someone.";

/** Turn off: the scheduler starts nothing and keeps its settings for the next time. */
function TurnOffButton({ project }: { project: SchedulerProject }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      aria-label={`Turn off the scheduler of ${project.name}`}
      onClick={() => startTransition(async () => void (await turnOffSchedulerAction({ projectId: project.id })))}
    >
      <PowerIcon data-icon="inline-start" />
      Turn off
    </Button>
  );
}

/** A project without a plan: the scheduler has no Ready tasks to start, and the way to give it a plan. */
function NoPlan({ project }: { project: SchedulerProject & { repo?: string } }) {
  return (
    <div className={CARD_BODY}>
      <div className="flex items-start gap-3 rounded-lg border bg-muted/50 p-4">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">
          <ListTreeIcon aria-hidden className="size-4 text-muted-foreground" />
        </span>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-[13px] font-semibold">{project.name} has no plan</h3>
            <p className="text-[13px] text-muted-foreground">The scheduler starts runs on the plan&apos;s Ready tasks, so it needs a GitHub Project linked to {project.name} first.</p>
          </div>
          <div>
            <SetUpPlanDialog size="sm" project={{ id: project.id, name: project.name, repo: project.repo ?? "" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The worker's Claude cap, which the scheduler leaves alone. */
function ClaudeCap({ slots }: { slots: number | null }) {
  return (
    <p className="flex items-start gap-2 rounded-md border bg-muted/50 px-3 py-2 text-[13px] text-muted-foreground">
      <CpuIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      {slots === null
        ? "No worker is running, so nothing starts until one is."
        : `The worker runs ${slots} Claude ${slots === 1 ? "process" : "processes"} at a time for all projects (HANDOFF_CAP_CLI). Runs above that take turns at their Claude steps.`}
    </p>
  );
}

/** The state and what it allows: Pause or Resume, and Turn off while it is on. */
function StateActions({ project, card }: { project: SchedulerProject; card: SchedulerCard }) {
  const { state, paused } = card.status;
  return (
    <>
      <SchedulerBadge state={state} selfPaused={paused?.by === "scheduler"} />
      {state === "paused" && <ResumeButton project={project} />}
      {state !== "paused" && state !== "off" && <PauseButton project={project} />}
      {state !== "off" && <TurnOffButton project={project} />}
    </>
  );
}

/** The fields and their button: Turn on while off, else Save, which keeps a pause. */
function SettingsForm({ project, card, form }: { project: SchedulerProject; card: SchedulerCard; form: SchedulerFormContext }) {
  const id = useId();
  const { status } = card;
  const off = status.state === "off";
  const [values, setValues] = useState<SchedulerValues>(() => initialValues(status.settings, form));
  const [skipLabel, setSkipLabel] = useState(status.settings ? (status.settings.skipLabel ?? "") : "human");
  const [error, setError] = useState<string>();
  const [saving, startSaving] = useTransition();
  const save = () =>
    startSaving(async () => {
      const result = await saveSchedulerAction({ projectId: project.id, ...values, skipLabel });
      setError(result.ok ? undefined : result.error);
    });
  return (
    <div className={cn(CARD_BODY, "flex flex-col gap-4")}>
      <SchedulerFields values={values} onChange={setValues} form={form} wide hints={{ maxRuns: "1 to 10. Runs a person starts count too.", noPriority: "Add a single select field named Priority to order by it." }} />
      <Field orientation="horizontal" className="items-center">
        <FieldLabel htmlFor={`${id}-skip`} className="w-40 shrink-0">
          Skips tasks labelled
        </FieldLabel>
        <Input id={`${id}-skip`} value={skipLabel} maxLength={50} onChange={(e) => setSkipLabel(e.target.value)} className="h-8 w-40 font-mono text-xs" />
        <FieldDescription className="text-xs">Empty skips no label.</FieldDescription>
      </Field>
      <ClaudeCap slots={status.claudeSlots} />
      {off && <p className="text-[13px]">{approvalSentence(project.name, values)}</p>}
      {error && <FieldError>{error}</FieldError>}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={saving || !values.graph} onClick={save}>
          {off ? "Turn on" : "Save"}
        </Button>
        {status.state === "paused" && <span className="text-xs text-muted-foreground">Saving keeps the scheduler paused. Resume starts it again.</span>}
      </div>
    </div>
  );
}

/**
 * Project settings' Scheduler section: the state with its action, the runs at a time, the order, the
 * graph, the skip label and the worker's Claude cap. Off, its button turns the scheduler on with these
 * fields; on, Save changes them and keeps a pause, since only Resume resumes.
 */
export function SchedulerSettings({ project, card, form }: { project: SchedulerProject & { repo?: string }; card: SchedulerCard; form: SchedulerFormContext }) {
  const planned = form.planNumber !== null;
  return (
    <section aria-label="Scheduler">
      <SectionCard title="Scheduler" description={DESCRIPTION} action={planned ? <StateActions project={project} card={card} /> : <SchedulerBadge state="off" />}>
        {planned ? <SettingsForm project={project} card={card} form={form} /> : <NoPlan project={project} />}
      </SectionCard>
    </section>
  );
}
