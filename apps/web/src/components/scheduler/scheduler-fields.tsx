"use client";

import { useId } from "react";
import { MinusIcon, PlusIcon } from "lucide-react";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { priorityField, type SchedulerFormContext, type SchedulerValues } from "@/lib/scheduler-form";

const MIN = 1;
const MAX = 10;
const clamp = (n: number) => Math.min(MAX, Math.max(MIN, Math.round(n)));

/**
 * Runs at a time (1 to 10, with one fewer and one more), the order (Priority disabled with the reason
 * when there is no Priority to read, else with the field it reads) and the graph, each label beside its control; `wide`
 * gives the labels the settings section's width.
 */
export function SchedulerFields({
  values,
  onChange,
  form,
  wide = false,
  hints,
}: {
  values: SchedulerValues;
  onChange: (next: SchedulerValues) => void;
  form: SchedulerFormContext;
  wide?: boolean;
  /** Extra lines under runs at a time and under the order in the settings section. */
  hints?: { maxRuns?: string; noPriority?: string };
}) {
  const id = useId();
  // A horizontal Field lets its label grow; these keep one width so the controls line up.
  const label = wide ? "w-40 flex-none!" : "w-28 flex-none!";
  const set = (patch: Partial<SchedulerValues>) => onChange({ ...values, ...patch });
  const noPriority = `GitHub Project #${form.planNumber ?? "?"} has no Priority field.${hints?.noPriority ? ` ${hints.noPriority}` : ""}`;
  return (
    <FieldGroup className="gap-3">
      <Field orientation="horizontal" className="items-center">
        <FieldLabel htmlFor={`${id}-runs`} className={label}>
          Runs at a time
        </FieldLabel>
        <InputGroup className="w-28">
          <InputGroupAddon>
            <InputGroupButton size="icon-xs" aria-label="One fewer" disabled={values.maxRuns <= MIN} onClick={() => set({ maxRuns: clamp(values.maxRuns - 1) })}>
              <MinusIcon />
            </InputGroupButton>
          </InputGroupAddon>
          <InputGroupInput
            id={`${id}-runs`}
            type="number"
            inputMode="numeric"
            min={MIN}
            max={MAX}
            value={values.maxRuns}
            onChange={(e) => set({ maxRuns: clamp(Number(e.target.value) || MIN) })}
            className="text-center tabular-nums"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" aria-label="One more" disabled={values.maxRuns >= MAX} onClick={() => set({ maxRuns: clamp(values.maxRuns + 1) })}>
              <PlusIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <FieldDescription className="text-xs">{hints?.maxRuns ?? "1 to 10"}</FieldDescription>
      </Field>
      <Field orientation="horizontal" className="items-start">
        <FieldLabel id={`${id}-order`} className={`${label} pt-1.5`}>
          Order
        </FieldLabel>
        <div className="flex flex-col gap-1">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            aria-labelledby={`${id}-order`}
            value={values.order}
            onValueChange={(order) => order && set({ order: order as SchedulerValues["order"] })}
          >
            <ToggleGroupItem value="project">Project order</ToggleGroupItem>
            <ToggleGroupItem value="priority" disabled={!form.priority}>
              Priority
            </ToggleGroupItem>
          </ToggleGroup>
          <FieldDescription className="text-xs">{form.priority ? `Priority comes from ${priorityField(form.priority)}.` : noPriority}</FieldDescription>
        </div>
      </Field>
      <Field orientation="horizontal" className="items-center">
        <FieldLabel htmlFor={`${id}-graph`} className={label}>
          Graph
        </FieldLabel>
        <NativeSelect id={`${id}-graph`} size="sm" value={values.graph} onChange={(e) => set({ graph: e.target.value })} className="min-w-40 font-mono">
          {form.graphs.map((g) => (
            <NativeSelectOption key={g} value={g}>
              {g}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
    </FieldGroup>
  );
}
