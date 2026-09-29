"use client";

import { useActionState } from "react";
import { saveAgent, saveMcpServer, saveSkill, type FormState } from "@/app/library/actions";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

function useForm(action: Action) {
  return useActionState(action, {} as FormState);
}

function Status({ state }: { state: FormState }) {
  if (state.ok && state.message) return <p className="text-sm text-muted-foreground">{state.message}</p>;
  return null;
}

function TextField({
  name,
  label,
  state,
  description,
  multiline,
  placeholder,
  defaultValue,
  rows,
}: {
  name: string;
  label: string;
  state: FormState;
  description?: string;
  multiline?: boolean;
  placeholder?: string;
  defaultValue?: string;
  rows?: number;
}) {
  const error = state.errors?.[name];
  const id = `field-${name}`;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {multiline ? (
        <Textarea id={id} name={name} rows={rows ?? 6} placeholder={placeholder} defaultValue={state.values?.[name] ?? defaultValue} aria-invalid={error ? true : undefined} className="font-mono text-xs" />
      ) : (
        <Input id={id} name={name} placeholder={placeholder} defaultValue={state.values?.[name] ?? defaultValue} aria-invalid={error ? true : undefined} />
      )}
      {description && <FieldDescription>{description}</FieldDescription>}
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}

export function SkillForm() {
  const [state, action, pending] = useForm(saveSkill);
  return (
    <form action={action}>
      <FieldGroup>
        <TextField name="name" label="Name" state={state} placeholder="ci-triage" />
        <TextField name="description" label="Description" state={state} description="When Claude should use this skill. It decides from this line." />
        <TextField name="body" label="Instructions" state={state} multiline rows={10} placeholder="Start from the failing test..." />
        <Field orientation="horizontal">
          <Button type="submit" disabled={pending}>
            Save skill
          </Button>
          <Status state={state} />
        </Field>
      </FieldGroup>
    </form>
  );
}

export function McpServerForm() {
  const [state, action, pending] = useForm(saveMcpServer);
  return (
    <form action={action}>
      <FieldGroup>
        <TextField name="name" label="Name" state={state} placeholder="docs" description="Tools appear to Claude as mcp__name__tool." />
        <Field>
          <FieldLabel htmlFor="field-transport">Transport</FieldLabel>
          <NativeSelect key={state.values?.transport ?? "stdio"} id="field-transport" name="transport" defaultValue={state.values?.transport ?? "stdio"}>
            <NativeSelectOption value="stdio">stdio (local command)</NativeSelectOption>
            <NativeSelectOption value="http">http (remote URL)</NativeSelectOption>
          </NativeSelect>
        </Field>
        <TextField name="command" label="Command" state={state} placeholder="npx" description="For stdio servers." />
        <TextField name="args" label="Arguments" state={state} multiline rows={3} placeholder={"-y\n@example/docs-mcp"} description="One per line." />
        <TextField name="url" label="URL" state={state} placeholder="https://mcp.example.com" description="For http servers." />
        <TextField
          name="env"
          label="Environment"
          state={state}
          multiline
          rows={3}
          placeholder={"API_KEY=${secret:DOCS_API_KEY}"}
          description="KEY=value per line. Secrets stay in the worker environment; reference them as ${secret:NAME}."
        />
        <TextField name="headers" label="Headers" state={state} multiline rows={2} placeholder={"Authorization: Bearer ${secret:DOCS_TOKEN}"} description="Name: value per line." />
        <TextField name="tools" label="Allowed tools" state={state} placeholder="search, fetch" description="Comma separated. Leave empty to allow every tool of this server." />
        <Field orientation="horizontal">
          <Button type="submit" disabled={pending}>
            Save server
          </Button>
          <Status state={state} />
        </Field>
      </FieldGroup>
    </form>
  );
}

export function AgentForm() {
  const [state, action, pending] = useForm(saveAgent);
  return (
    <form action={action}>
      <FieldGroup>
        <TextField name="name" label="Name" state={state} placeholder="explorer" />
        <TextField name="description" label="Description" state={state} description="When Claude should hand work to this subagent." />
        <TextField name="prompt" label="Prompt" state={state} multiline rows={8} />
        <TextField name="tools" label="Tools" state={state} placeholder="Read, Grep, Glob" description="Comma separated. Empty inherits the node's tools." />
        <TextField name="model" label="Model" state={state} placeholder="haiku" description="Optional alias or full model ID." />
        <Field orientation="horizontal">
          <Button type="submit" disabled={pending}>
            Save agent
          </Button>
          <Status state={state} />
        </Field>
      </FieldGroup>
    </form>
  );
}
