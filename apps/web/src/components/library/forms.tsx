"use client";

import { useActionState, useState, useTransition } from "react";
import { PlugZapIcon } from "lucide-react";
import { saveAgent, saveMcpServer, testMcpServerAction, type FormState, type McpTestState } from "@/app/library/actions";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { McpCheckResult } from "./mcp-check-result";

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

export type McpServerValues = { name: string; transport: "stdio" | "http"; auth: "headers" | "oauth"; command: string | null; args: string[]; url: string | null; env: Record<string, string>; headers: Record<string, string>; tools: string[] };
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
  const [tested, test, testing] = useActionState(testMcpServerAction, {} as McpTestState);
  const [, startTest] = useTransition();
  const [tools, setTools] = useState(state.values?.tools ?? initial?.tools.join(", ") ?? "");
  const transport = state.values?.transport ?? initial?.transport ?? "stdio";
  const [auth, setAuth] = useState(state.values?.auth ?? initial?.auth ?? "headers");
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
        <Field>
          <FieldLabel htmlFor="field-auth">Authentication</FieldLabel>
          <NativeSelect id="field-auth" name="auth" value={auth} onChange={(e) => setAuth(e.target.value)}>
            <NativeSelectOption value="headers">Headers (API key or token)</NativeSelectOption>
            <NativeSelectOption value="oauth">OAuth sign-in</NativeSelectOption>
          </NativeSelect>
          <FieldDescription>For http servers. With OAuth sign-in, save the server, then sign in on its page; runs send the token as an Authorization header.</FieldDescription>
        </Field>
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
        <Field>
          <FieldLabel htmlFor="field-tools">Allowed tools</FieldLabel>
          <Input id="field-tools" name="tools" placeholder="search, fetch" value={tools} onChange={(e) => setTools(e.target.value)} />
          <FieldDescription>Comma separated. Leave empty to allow every tool of this server. Test the server to pick from its tools.</FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <Button type="submit" disabled={pending}>
            Save server
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={testing}
            onClick={(e) => {
              // Not a form action: React resets a form after its action runs, which would clear the fields.
              const data = new FormData(e.currentTarget.form ?? undefined);
              startTest(() => test(data));
            }}
          >
            <PlugZapIcon data-icon="inline-start" />
            {testing ? "Testing" : "Test server"}
          </Button>
          <Status state={state} />
        </Field>
        {tested.errors && <FieldError>{Object.values(tested.errors).join(" ")}</FieldError>}
        {tested.check && <McpCheckResult key={tested.check.checkedAt} check={tested.check} onAllow={(names) => setTools(names.join(", "))} onUseOAuth={() => setAuth("oauth")} />}
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
