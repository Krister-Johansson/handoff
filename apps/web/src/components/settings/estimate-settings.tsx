"use client";

import { useId, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { DEFAULT_PLAN_BUDGET, type PlanBudget } from "@handoff/core";
import { setPlanBudgetAction } from "@/app/projects/actions";
import { CARD_BODY, SectionCard, TD, TH } from "@/components/section-card";
import { Tag } from "@/components/tag";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration } from "@/lib/plan/duration";
import { DEFAULT_MINUTES, FORECAST_MIN_RUNS, type Forecast, type Forecasts } from "@/lib/plan/forecast";
import { SIZES } from "@/lib/plan/size-text";
import { cn } from "@/lib/utils";
import { CapacityPopover } from "./capacity-popover";

/** Hours as the plan writes them, never in days: "6h", "7h 30m". */
const hoursText = (hours: number) => formatDuration(hours, Infinity);
/** Minutes as the forecasts table writes them: "25m", "1h 50m". */
const minutesText = (minutes: number) => hoursText(minutes / 60);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** One section of Estimates: a card with a title, what it is for and its content, named for a screen reader. */
function Section({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <SectionCard title={title} description={description} action={action}>
        {children}
      </SectionCard>
    </section>
  );
}

/** The person's hours of work a day on the plan, with Change opening the capacity popover. */
function Capacity({ projectId, capacity }: { projectId: string; capacity: number }) {
  return (
    <Section
      title="Capacity"
      description="Hours of work a day on the plan. A sized task's bar on the timeline is its duration over the capacity, and Arrange fills each day up to it."
      action={
        <CapacityPopover projectId={projectId} capacity={capacity}>
          <Button size="sm" variant="outline">
            Change
          </Button>
        </CapacityPopover>
      }
    >
      <p className={cn(CARD_BODY, "flex flex-col gap-0.5 text-[13px]")}>
        <span className="font-medium">{hoursText(capacity)} a day</span>
        <span className="text-muted-foreground">Every day counts, weekends too.</span>
      </p>
    </Section>
  );
}

/** A size under five runs: its default, and what its runs measured so far. */
function DefaultCells({ forecast }: { forecast: Forecast }) {
  const { size, runs, measuredMinutes } = forecast;
  const measured = runs === 0 || measuredMinutes === null ? `No ${size} runs yet` : `Measured ${minutesText(measuredMinutes)} over ${plural(runs, "run")}`;
  return (
    <>
      <TableCell className={TD}>
        <span className="font-medium underline decoration-dotted underline-offset-3">{minutesText(forecast.minutes)}</span> <Tag>Default</Tag>
      </TableCell>
      <TableCell colSpan={4} className={cn(TD, "text-muted-foreground")}>
        {measured}; the forecast starts at {FORECAST_MIN_RUNS}.
      </TableCell>
    </>
  );
}

/** A size with enough runs: the median wall time, its parts and the median cost. */
function RunCells({ forecast }: { forecast: Forecast }) {
  const parts = forecast.parts ?? { agent: 0, queue: 0, waiting: 0 };
  const NUM = cn(TD, "text-muted-foreground tabular-nums");
  return (
    <>
      <TableCell className={cn(TD, "font-medium")}>{minutesText(forecast.minutes)}</TableCell>
      <TableCell className={NUM} title="Includes CI and pull request waits">
        {minutesText(parts.agent)}
      </TableCell>
      <TableCell className={NUM}>{minutesText(parts.queue)}</TableCell>
      <TableCell className={NUM}>{minutesText(parts.waiting)}</TableCell>
      <TableCell className={NUM}>${(forecast.costUsd ?? 0).toFixed(2)}</TableCell>
    </>
  );
}

/** What each size usually takes in this project, from its finished runs, with the defaults under five runs. */
function ForecastTable({ forecasts }: { forecasts: Forecasts }) {
  const defaults = SIZES.map((size) => `${size} ${minutesText(DEFAULT_MINUTES[size])}`).join(", ");
  return (
    <Section
      title="Forecasts from finished runs"
      description={`The median wall time of this project's finished runs per size, from the run's start to its end. A size with fewer than ${FORECAST_MIN_RUNS} runs uses its default.`}
    >
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {["Size", "Usually", "Agent", "Queue", "Waiting on you", "Cost"].map((head) => (
              <TableHead key={head} className={TH}>
                {head}
              </TableHead>
            ))}
            <TableHead className={cn(TH, "text-right")}>Runs</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {SIZES.map((size) => {
            const forecast = forecasts[size];
            return (
              <TableRow key={size} className="hover:bg-muted">
                <TableCell className={cn(TD, "font-mono font-semibold")}>{size}</TableCell>
                {forecast.source === "runs" ? <RunCells forecast={forecast} /> : <DefaultCells forecast={forecast} />}
                <TableCell className={cn(TD, "text-right text-muted-foreground tabular-nums")}>{forecast.runs}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className={cn(CARD_BODY, "border-t pt-3 text-xs text-muted-foreground")}>Defaults: {defaults}.</p>
    </Section>
  );
}

/** The most files and steps a plan may have before its planner proposes a split; empty takes the default. */
function PlanBudgetForm({ projectId, planBudget }: { projectId: string; planBudget: PlanBudget | null }) {
  const id = useId();
  const [files, setFiles] = useState(planBudget ? String(planBudget.files) : "");
  const [steps, setSteps] = useState(planBudget ? String(planBudget.steps) : "");
  const [error, setError] = useState<string>();
  const [saving, startSaving] = useTransition();
  const save = (e: FormEvent) => {
    e.preventDefault();
    startSaving(async () => {
      const result = await setPlanBudgetAction({ projectId, files, steps });
      setError(result.ok ? undefined : result.error);
    });
  };
  const number = (label: string, value: string, onChange: (value: string) => void, placeholder: number) => (
    <Field className="w-28">
      <FieldLabel htmlFor={`${id}-${label}`}>{label}</FieldLabel>
      <Input id={`${id}-${label}`} type="number" min={1} max={500} placeholder={String(placeholder)} value={value} onChange={(e) => onChange(e.target.value)} className="h-8" />
    </Field>
  );
  return (
    <Section title="Plan budget" description="The most files and steps a plan may have. A planner over it proposes a split, which a plan gate offers as Split as proposed.">
      <form onSubmit={save} className={cn(CARD_BODY, "flex flex-col gap-3")}>
        <div className="flex flex-wrap items-end gap-3">
          {number("Files", files, setFiles, DEFAULT_PLAN_BUDGET.files)}
          {number("Steps", steps, setSteps, DEFAULT_PLAN_BUDGET.steps)}
        </div>
        <FieldDescription className="text-xs">
          Empty means {DEFAULT_PLAN_BUDGET.files} files and {DEFAULT_PLAN_BUDGET.steps} steps.
        </FieldDescription>
        {error && <FieldError>{error}</FieldError>}
        <div>
          <Button type="submit" size="sm" disabled={saving}>
            Save
          </Button>
        </div>
      </form>
    </Section>
  );
}

type EstimateSettingsProps = { projectId: string; planBudget: PlanBudget | null } & ({ mode: "timeline"; capacity: number; forecasts: Forecasts } | { mode: "flow" });

/**
 * Project settings' Estimates: in a Timeline project the capacity in hours a day, what each size usually takes
 * from this project's finished runs, and the plan budget; in a Flow project, which has no hours, the plan budget
 * only. The page keys it on the stored values, so a save shows them again.
 */
export function EstimateSettings(props: EstimateSettingsProps) {
  const { projectId, planBudget } = props;
  return (
    <>
      {props.mode === "timeline" && (
        <>
          <Capacity projectId={projectId} capacity={props.capacity} />
          <ForecastTable forecasts={props.forecasts} />
        </>
      )}
      <PlanBudgetForm projectId={projectId} planBudget={planBudget} />
    </>
  );
}
