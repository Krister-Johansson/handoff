"use client";

import { useActionState, useState } from "react";
import { PlugIcon } from "lucide-react";
import { addMcpFromUrlAction, type AddFromUrlState } from "@/app/library/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { suggestMcpName } from "@/lib/mcp-name";
import { McpServerForm } from "./forms";

function FromUrl({ state, action, pending }: { state: AddFromUrlState; action: (form: FormData) => void; pending: boolean }) {
  const [url, setUrl] = useState(state.values?.url ?? "");
  return (
    <form action={action}>
      <FieldGroup>
        <Field data-invalid={state.error ? true : undefined}>
          <FieldLabel htmlFor="add-url">Server URL</FieldLabel>
          <Input id="add-url" name="url" type="url" placeholder="https://mcp.context7.com/mcp/oauth" value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono" />
          <FieldDescription>handoff connects to it. A server that offers OAuth takes you to its sign-in; one that needs an API key opens the manual form.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="add-name">Name</FieldLabel>
          <Input id="add-name" name="name" placeholder={suggestMcpName(url) || "docs"} defaultValue={state.values?.name} className="font-mono" />
          <FieldDescription>Optional. Tools appear to Claude as mcp__name__tool.</FieldDescription>
        </Field>
        {state.error && <FieldError>{state.error}</FieldError>}
        <Field orientation="horizontal">
          <Button type="submit" disabled={pending || !url}>
            <PlugIcon data-icon="inline-start" />
            {pending ? "Connecting" : "Add server"}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  );
}

/** A new MCP server: from its URL alone, or configured by hand. */
export function NewMcpServer() {
  const [tab, setTab] = useState("url");
  const [state, action, pending] = useActionState(async (previous: AddFromUrlState, form: FormData) => {
    const result = await addMcpFromUrlAction(previous, form);
    if (result.manual) setTab("manual");
    return result;
  }, {});
  return (
    <Tabs value={tab} onValueChange={setTab} className="max-w-2xl">
      <TabsList>
        <TabsTrigger value="url">From URL</TabsTrigger>
        <TabsTrigger value="manual">Manual</TabsTrigger>
      </TabsList>
      <Card>
        <CardContent>
          <TabsContent value="url">
            <FromUrl state={state} action={action} pending={pending} />
          </TabsContent>
          <TabsContent value="manual" className="flex flex-col gap-4">
            {state.message && (
              <Alert>
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            )}
            <McpServerForm key={state.manual?.url ?? "blank"} {...(state.manual ? { draft: state.manual } : {})} />
          </TabsContent>
        </CardContent>
      </Card>
    </Tabs>
  );
}
