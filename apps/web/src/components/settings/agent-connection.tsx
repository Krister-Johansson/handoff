"use client";

import { useState, useTransition, type ReactNode } from "react";
import { CheckIcon, CopyIcon, RefreshCwIcon } from "lucide-react";
import { disableAgentAction, enableAgentAction, regenerateAgentAction } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const STARTER_PROMPT = "Use handoff to show what needs my attention, then list the backlog of my projects.";

/** The token's first and last four characters, so the page never shows the whole secret. */
const masked = (token: string) => `${token.slice(0, 4)}…${token.slice(-4)}`;

/** One line to paste somewhere, with a copy button. `shown` replaces the text on the page; copying takes `text`. */
function CopyLine({ text, shown = text, label }: { text: string; shown?: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access denied; the text can still be selected.
    }
  };
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-subtle px-2.5 py-[7px] font-mono text-xs whitespace-nowrap">{shown}</code>
      <Button type="button" size="icon-sm" variant="outline" aria-label={`Copy ${label}`} onClick={() => void copy()}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  );
}

/** One step of connecting: a short title, what it does, and the lines to paste. */
function Step({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function Instructions({ origin, checkout, token }: { origin: string; checkout: string; token: string }) {
  const mcpAdd = (bearer: string) => `claude mcp add --transport http handoff ${origin}/api/mcp --header "Authorization: Bearer ${bearer}"`;
  return (
    <div className="flex flex-col gap-3.5">
      <Step title="Get the plugin" description="In Claude Code, add the marketplace from GitHub or from this checkout, install the plugin, and enter the token when it asks.">
        <CopyLine label="marketplace command" text="/plugin marketplace add Krister-Johansson/handoff" />
        <CopyLine label="local marketplace command" text={`/plugin marketplace add ${checkout}`} />
        <CopyLine label="install command" text="/plugin install handoff@handoff" />
      </Step>
      <Step
        title="Hear about questions while you work"
        description="Start Claude Code with handoff's channel to hear about questions, failed runs and reviews. Channels are a research preview; plugins outside Anthropic's list load only with the development flag, which asks you to confirm when Claude Code starts."
      >
        <CopyLine label="channels command" text="claude --dangerously-load-development-channels plugin:handoff@handoff" />
      </Step>
      <Step title="Other ways to connect" description="Without the plugin, add the MCP server by hand. You get the tools, but no messages while you work.">
        <CopyLine label="mcp add command" text={mcpAdd(token)} shown={mcpAdd(masked(token))} />
      </Step>
      <Step title="Paste this into your agent">
        <CopyLine label="starter prompt" text={STARTER_PROMPT} />
      </Step>
    </div>
  );
}

/**
 * Connect Claude Code to handoff. Turning agent connections on creates a token in a file on this
 * machine; agents send it to /api/mcp. Turning them off deletes it.
 */
export function AgentConnection({
  origin,
  checkout,
  initialToken,
  lastConnection,
}: {
  origin: string;
  checkout: string;
  initialToken: string | undefined;
  /** Already worded on the server, as "Last connected: claude-code 2.1.285 at …". */
  lastConnection?: string | undefined;
}) {
  const [token, setToken] = useState(initialToken);
  const [pending, startTransition] = useTransition();
  const toggle = (on: boolean) =>
    startTransition(async () => {
      if (on) setToken((await enableAgentAction()).token);
      else {
        await disableAgentAction();
        setToken(undefined);
      }
    });
  const regenerate = () => startTransition(async () => setToken((await regenerateAgentAction()).token));
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="agent-connections">Enable agent connections</Label>
          <span className="text-xs text-muted-foreground">{token ? (lastConnection ?? "On. No agent has connected yet.") : "Off"}</span>
        </div>
        <Switch id="agent-connections" checked={Boolean(token)} disabled={pending} onCheckedChange={toggle} />
      </div>
      {token && (
        <>
          <div className="flex flex-col gap-1.5 border-t pt-4">
            <span className="text-[13px] font-medium">Token</span>
            <div className="flex items-center gap-2">
              <CopyLine label="token" text={token} shown={masked(token)} />
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={regenerate}>
                <RefreshCwIcon data-icon="inline-start" />
                Regenerate
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Kept in a file on this machine, not in the database. Regenerating disconnects agents that use the old token.</p>
          </div>
          <Instructions origin={origin} checkout={checkout} token={token} />
        </>
      )}
    </div>
  );
}
