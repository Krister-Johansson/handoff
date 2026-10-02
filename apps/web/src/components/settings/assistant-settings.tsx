"use client";

import { useOptimistic, useTransition, type ReactNode } from "react";
import { setAssistantEnabledAction, setAssistantModelAction } from "@/app/settings/actions";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { WebMcpSetting } from "./webmcp-setting";

const MODELS = [
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
  { value: "haiku", label: "Haiku" },
] as const;
type Model = (typeof MODELS)[number]["value"];

function Row({ id, title, description, children }: { id: string; title: string; description: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t py-3.5 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id}>{title}</Label>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * The assistant's settings: whether it runs, the model it asks Claude Code for and the one that ran
 * last, and whether this browser offers the dashboard's tools to browser agents.
 */
export function AssistantSettings({ hasToken, enabled, model, lastModel }: { hasToken: boolean; enabled: boolean; model: string; lastModel?: string | undefined }) {
  const [on, setOn] = useOptimistic(enabled);
  const [chosen, setChosen] = useOptimistic<string>(model);
  const [, start] = useTransition();
  const toggle = (next: boolean) =>
    start(async () => {
      setOn(next);
      await setAssistantEnabledAction(next);
    });
  const choose = (next: Model) =>
    start(async () => {
      setChosen(next);
      await setAssistantModelAction(next);
    });
  return (
    <div className="flex flex-col text-sm">
      <Row
        id="assistant-enabled"
        title="Assistant"
        description={
          hasToken
            ? "Answers in the panel beside every page and acts after you approve, with Claude Code on your subscription."
            : "Add CLAUDE_CODE_OAUTH_TOKEN (from claude setup-token) to the dashboard's environment and restart it. The assistant runs Claude Code on your subscription."
        }
      >
        <Switch id="assistant-enabled" checked={hasToken && on} disabled={!hasToken} onCheckedChange={toggle} />
      </Row>
      <Row id="assistant-model" title="Model" description={lastModel ? `Last ran ${lastModel}.` : "No turn has run yet."}>
        <NativeSelect id="assistant-model" value={chosen} onChange={(e) => choose(e.target.value as Model)}>
          {MODELS.map((m) => (
            <NativeSelectOption key={m.value} value={m.value}>
              {m.label}
            </NativeSelectOption>
          ))}
          {/* HANDOFF_ASSISTANT_MODEL may name a model outside the three. */}
          {!MODELS.some((m) => m.value === model) && <NativeSelectOption value={model}>{model}</NativeSelectOption>}
        </NativeSelect>
      </Row>
      <div className="border-t pt-3.5">
        <WebMcpSetting />
      </div>
    </div>
  );
}
