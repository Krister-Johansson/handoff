"use client";

import { useActionState } from "react";
import { saveGroup, type FormState } from "@/app/library/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export type GroupValues = { name: string; description: string; skills: string[]; mcp: string[]; agents: string[] };
type Library = { skills: string[]; mcp: string[]; agents: string[] };

const KINDS = [
  { key: "skills", legend: "Skills" },
  { key: "mcp", legend: "MCP servers" },
  { key: "agents", legend: "Subagents" },
] as const;

/** A named set of library entries; a node that enables the group gets all of them. */
export function GroupForm({ library, initial }: { library: Library; initial?: GroupValues }) {
  const [state, action, pending] = useActionState(saveGroup, {} as FormState);
  const nameError = state.errors?.name;
  return (
    <form action={action}>
      <FieldGroup>
        {initial ? (
          <input type="hidden" name="name" value={initial.name} />
        ) : (
          <Field data-invalid={nameError ? true : undefined}>
            <input type="hidden" name="$new" value="1" />
            <FieldLabel htmlFor="group-name">Name</FieldLabel>
            <Input id="group-name" name="name" placeholder="frontend" defaultValue={state.values?.name} className="font-mono" />
            {nameError && <FieldError>{nameError}</FieldError>}
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="group-description">Description</FieldLabel>
          <Input id="group-description" name="description" defaultValue={state.values?.description ?? initial?.description} placeholder="Frontend work in React with shadcn" />
          <FieldDescription>What the group is for, shown when picking it for a node.</FieldDescription>
        </Field>
        <div className="grid gap-6 sm:grid-cols-3">
          {KINDS.map((kind) => (
            <FieldSet key={kind.key}>
              <FieldLegend variant="label">{kind.legend}</FieldLegend>
              {library[kind.key].length === 0 ? (
                <FieldDescription>None in the library yet.</FieldDescription>
              ) : (
                <FieldGroup data-slot="checkbox-group">
                  {library[kind.key].map((name) => (
                    <Field key={name} orientation="horizontal">
                      <Checkbox id={`group-${kind.key}-${name}`} name={kind.key} value={name} defaultChecked={initial?.[kind.key].includes(name)} />
                      <FieldLabel htmlFor={`group-${kind.key}-${name}`} className="font-mono text-xs font-normal">
                        {name}
                      </FieldLabel>
                    </Field>
                  ))}
                </FieldGroup>
              )}
            </FieldSet>
          ))}
        </div>
        {state.errors?.entries && <FieldError>{state.errors.entries}</FieldError>}
        <Field orientation="horizontal">
          <Button type="submit" disabled={pending}>
            Save group
          </Button>
          {state.ok && state.message && <span className="text-sm text-muted-foreground">{state.message}</span>}
        </Field>
      </FieldGroup>
    </form>
  );
}
