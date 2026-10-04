"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { CalendarClockIcon, ChevronDownIcon, ListTreeIcon, PauseIcon, PlayIcon, SlidersHorizontalIcon } from "lucide-react";
import { pauseSchedulerAction, resumeSchedulerAction, turnOnSchedulerAction, type SchedulerActionState } from "@/app/projects/scheduler-actions";
import type { StartRunContext } from "@/components/plan/plan-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { planPath, projectPath } from "@/lib/paths";
import { approvalSentence, initialValues, settingsLine, type SchedulerFormContext, type SchedulerValues } from "@/lib/scheduler-form";
import { checkText } from "@/lib/scheduler-text";
import { cn } from "@/lib/utils";
import type { SchedulerCard as CardData } from "@/server/scheduler-card";
import { SchedulerBadge } from "./scheduler-badge";
import { SchedulerBody } from "./scheduler-body";
import { SchedulerFields } from "./scheduler-fields";
import { useFolded } from "./use-folded";

export type SchedulerProject = { id: string; name: string };

/** Runs a scheduler action and keeps its refusal to show. */
function useAction() {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<SchedulerActionState>, done?: () => void) =>
    startTransition(async () => {
      const result = await action();
      setError(result.ok ? undefined : result.error);
      if (result.ok) done?.();
    });
  return { error, pending, run, clear: () => setError(undefined) };
}

/** Turn on: a popover with the form, and the approval sentence it acts on. The popover is the confirmation. */
export function TurnOnButton({ project, form, settings, size = "sm" }: { project: SchedulerProject; form: SchedulerFormContext; settings?: CardData["status"]["settings"]; size?: "sm" | "xs" }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<SchedulerValues>(() => initialValues(settings, form));
  const action = useAction();
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setValues(initialValues(settings, form));
        action.clear();
      }}
    >
      <PopoverTrigger asChild>
        <Button size={size} variant="outline" aria-label={`Turn on the scheduler of ${project.name}`}>
          <PlayIcon data-icon="inline-start" />
          Turn on
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] gap-3 p-3.5" aria-label="Turn on the scheduler">
        <PopoverHeader>
          <PopoverTitle className="font-semibold">Turn on the scheduler</PopoverTitle>
          <PopoverDescription className="text-xs">It starts nothing while a failed run or a permission prompt waits on someone.</PopoverDescription>
        </PopoverHeader>
        <SchedulerFields values={values} onChange={setValues} form={form} />
        <p className="rounded-md border bg-muted px-3 py-2 text-[13px] leading-snug">{approvalSentence(project.name, values, form.priority)}</p>
        {action.error && <FieldError>{action.error}</FieldError>}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={action.pending || !values.graph} onClick={() => action.run(() => turnOnSchedulerAction({ projectId: project.id, ...values }), () => setOpen(false))}>
            Turn on
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Pause: a popover with an optional reason. Active runs go on. */
export function PauseButton({ project, size = "sm" }: { project: SchedulerProject; size?: "sm" | "xs" }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const action = useAction();
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        action.clear();
      }}
    >
      <PopoverTrigger asChild>
        <Button size={size} variant="outline" aria-label={`Pause the scheduler of ${project.name}`}>
          <PauseIcon data-icon="inline-start" />
          Pause
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3 p-3.5" aria-label="Pause the scheduler">
        <PopoverHeader>
          <PopoverTitle className="font-semibold">Pause the scheduler</PopoverTitle>
          <PopoverDescription className="text-xs">Active runs go on. Nothing new starts until someone resumes.</PopoverDescription>
        </PopoverHeader>
        <Field>
          <FieldLabel htmlFor={`pause-reason-${project.id}`}>Reason (optional)</FieldLabel>
          <Input id={`pause-reason-${project.id}`} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {action.error && <FieldError>{action.error}</FieldError>}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={action.pending} onClick={() => action.run(() => pauseSchedulerAction({ projectId: project.id, reason }), () => setOpen(false))}>
            Pause
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Resume keeps the settings; a refusal shows beside it. */
export function ResumeButton({ project, size = "sm" }: { project: SchedulerProject; size?: "sm" | "xs" }) {
  const action = useAction();
  return (
    <span className="inline-flex items-center gap-2">
      {action.error && <span className="text-xs text-danger">{action.error}</span>}
      <Button size={size} variant="outline" disabled={action.pending} aria-label={`Resume the scheduler of ${project.name}`} onClick={() => action.run(() => resumeSchedulerAction({ projectId: project.id }))}>
        <PlayIcon data-icon="inline-start" />
        Resume
      </Button>
    </span>
  );
}

/** The one action the scheduler's state allows: Turn on, Pause or Resume. */
export function SchedulerAction({ project, card, form, size }: { project: SchedulerProject; card: CardData; form: SchedulerFormContext; size?: "sm" | "xs" }) {
  const { state, settings } = card.status;
  if (state === "off") return <TurnOnButton project={project} form={form} settings={settings} size={size} />;
  if (state === "paused") return <ResumeButton project={project} size={size} />;
  return <PauseButton project={project} size={size} />;
}

/** The header's line: Scheduler, the state, what it says, when it checked, the settings and the action. */
function Header({ project, card, form, now, fold, extra }: { project: SchedulerProject; card: CardData; form: SchedulerFormContext; now: Date; fold?: ReactNode; extra?: ReactNode }) {
  const { status } = card;
  const off = status.state === "off";
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2">
      <span className="flex items-center gap-2">
        <CalendarClockIcon aria-hidden className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Scheduler</h2>
        <SchedulerBadge state={status.state} selfPaused={status.paused?.by === "scheduler"} />
      </span>
      <span className="min-w-0 text-[13px] text-muted-foreground">{off ? "Starts runs on Ready tasks on its own, up to a limit you set." : (extra ?? status.summary)}</span>
      <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {!off && status.state !== "paused" && <span className="text-xs text-muted-foreground">{checkText(status, now)}</span>}
        {!off && status.settings && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link href={projectPath(project.id, "settings")} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline hover:underline-offset-3">
                <SlidersHorizontalIcon aria-hidden className="size-3.5" />
                {settingsLine(status.settings, form.priority)}
              </Link>
            </TooltipTrigger>
            <TooltipContent>Change in Project settings</TooltipContent>
          </Tooltip>
        )}
        <SchedulerAction project={project} card={card} form={form} />
        {fold}
      </span>
    </div>
  );
}

/** What the line on Home says: the holds point to Needs you, which lists them with their buttons. */
function lineText(card: CardData) {
  const { status } = card;
  const n = status.holds.length;
  if (status.state === "held") return `${n} ${n === 1 ? "item" : "items"} in Needs you ${n === 1 ? "holds" : "hold"} new starts. ${status.summary}.`;
  if (status.state === "paused") return status.paused?.by === "scheduler" ? "Paused itself after three failed starts." : "Paused by a person.";
  if (status.state === "idle" && status.idle) return status.idle.text;
  return `${status.summary}.`;
}

/**
 * The scheduler on Home: one line with its state and its action, and the way to the card on the Plan.
 * Nothing until someone has turned the scheduler on.
 */
export function SchedulerLine({ project, card, form }: { project: SchedulerProject; card: CardData; form: SchedulerFormContext }) {
  if (card.status.state === "off") return null;
  return (
    <Card className="gap-0 py-0" aria-label={`Scheduler of ${project.name}`} role="region">
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2">
        <span className="flex items-center gap-2">
          <CalendarClockIcon aria-hidden className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Scheduler</h2>
          <SchedulerBadge state={card.status.state} selfPaused={card.status.paused?.by === "scheduler"} />
        </span>
        <span className="min-w-0 text-[13px] text-muted-foreground">{lineText(card)}</span>
        <span className="ml-auto flex items-center gap-3">
          <Link href={planPath(project.id)} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline hover:underline-offset-3">
            <ListTreeIcon aria-hidden className="size-3.5" />
            Open on the Plan
          </Link>
          <SchedulerAction project={project} card={card} form={form} />
        </span>
      </div>
    </Card>
  );
}

/**
 * The scheduler on the Plan page: one header line with its state and its one action, and under it
 * what it is doing, folded or open as this browser last left it for the project. `start` gives the
 * skipped tasks Start run.
 */
export function SchedulerCard({
  project,
  card,
  form,
  start,
  now = new Date(),
}: {
  project: SchedulerProject;
  card: CardData;
  form: SchedulerFormContext;
  start?: StartRunContext | undefined;
  now?: Date;
}) {
  const [folded, setFolded] = useFolded(project.id);
  const hasBody = card.status.state !== "off";
  const fold = hasBody && (
    <Button size="icon-xs" variant="ghost" aria-expanded={!folded} aria-label={folded ? "Unfold the scheduler" : "Fold the scheduler"} onClick={() => setFolded(!folded)}>
      <ChevronDownIcon className={cn("transition-transform", !folded && "rotate-180")} />
    </Button>
  );
  return (
    <Card className="gap-0 py-0" aria-label={`Scheduler of ${project.name}`} role="region">
      <Header project={project} card={card} form={form} now={now} fold={fold} />
      {hasBody && !folded && <SchedulerBody project={project} card={card} start={start} now={now} />}
    </Card>
  );
}
