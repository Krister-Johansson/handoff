"use client";

import { useActionState } from "react";
import { saveAgent, saveMcpServer, type FormState } from "@/app/library/actions";
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

export type McpServerValues = { name: string; transport: "stdio" | "http"; command: string | null; args: string[]; url: string | null; env: Record<string, string>; headers: Record<string, string>; tools: string[] };
export type AgentValues = { name: string; description: string; prompt: string; tools: string[]; model: string | null };

const pairLines = (values: Record<string, string>, separator: string) =>
  Object.entries(values)
    .map(([k, v]) => `${k}${separator}${v}`)
    .join("\n");

/** The name field for a new entry, or the fixed name of an existing one. */
function NameField({ state, name, placeholder, description }: { state: FormState; name?: string | undefined; placeholder: string; description?: string }) {
  if (name) return <input type="hidden" name="name" value={name} />;
  return (
    <>
      <input type="hidden" name="$new" value="1" />
      <TextField name="name" label="Name" state={state} placeholder={placeholder} {...(description ? { description } : {})} />
    </>
  );
}

export function McpServerForm({ initial }: { initial?: McpServerValues }) {
  const [state, action, pending] = useForm(saveMcpServer);
  const transport = state.values?.transport ?? initial?.transport ?? "stdio";
  return (
    <form action={action}>
      <FieldGroup>
        <NameField state={state} name={initial?.name} placeholder="docs" description="Tools appear to Claude as mcp__name__tool." />
        <Field>
          <FieldLabel htmlFor="field-transport">Transport</FieldLabel>
          <NativeSelect key={transport} id="field-transport" name="transport" defaultValue={transport}>
            <NativeSelectOption value="stdio">stdio (local command)</NativeSelectOption>
            <NativeSelectOption value="http">http (remote URL)</NativeSelectOption>
          </NativeSelect>
        </Field>
        <TextField name="command" label="Command" state={state} placeholder="npx" description="For stdio servers." defaultValue={initial?.command ?? ""} />
        <TextField name="args" label="Arguments" state={state} multiline rows={3} placeholder={"-y\n@example/docs-mcp"} description="One per line." defaultValue={initial?.args.join("\n")} />
        <TextField name="url" label="URL" state={state} placeholder="https://mcp.example.com" description="For http servers." defaultValue={initial?.url ?? ""} />
        <TextField
          name="env"
          label="Environment"
          state={state}
          multiline
          rows={3}
          placeholder={"API_KEY=${secret:DOCS_API_KEY}"}
          description="KEY=value per line. Secrets stay in the worker environment; reference them as ${secret:NAME}."
          defaultValue={initial ? pairLines(initial.env, "=") : undefined}
        />
        <TextField
          name="headers"
          label="Headers"
          state={state}
          multiline
          rows={2}
          placeholder={"Authorization: Bearer ${secret:DOCS_TOKEN}"}
          description="Name: value per line."
          defaultValue={initial ? pairLines(initial.headers, ": ") : undefined}
        />
        <TextField
          name="tools"
          label="Allowed tools"
          state={state}
          placeholder="search, fetch"
          description="Comma separated. Leave empty to allow every tool of this server."
          defaultValue={initial?.tools.join(", ")}
        />
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

export function AgentForm({ initial }: { initial?: AgentValues }) {
  const [state, action, pending] = useForm(saveAgent);
  return (
    <form action={action}>
      <FieldGroup>
        <NameField state={state} name={initial?.name} placeholder="explorer" />
        <TextField name="description" label="Description" state={state} description="When Claude should hand work to this subagent." defaultValue={initial?.description} />
        <TextField name="prompt" label="Prompt" state={state} multiline rows={12} defaultValue={initial?.prompt} />
        <TextField name="tools" label="Tools" state={state} placeholder="Read, Grep, Glob" description="Comma separated. Empty inherits the node's tools." defaultValue={initial?.tools.join(", ")} />
        <TextField name="model" label="Model" state={state} placeholder="haiku" description="Optional alias or full model ID." defaultValue={initial?.model ?? ""} />
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
