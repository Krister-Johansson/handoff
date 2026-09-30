"use client";

import { useState, useTransition } from "react";
import { CheckIcon, CopyIcon, RefreshCwIcon } from "lucide-react";
import { disableAgentAction, enableAgentAction, regenerateAgentAction } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const STARTER_PROMPT = "Use handoff to show what needs my attention, then list the backlog of my projects.";

/** One line to paste somewhere, with a copy button. */
function CopyLine({ text, label }: { text: string; label: string }) {
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
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs whitespace-nowrap">{text}</code>
      <Button type="button" size="icon-sm" variant="outline" aria-label={`Copy ${label}`} onClick={() => void copy()}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  );
}

function Instructions({ origin, checkout, token }: { origin: string; checkout: string; token: string }) {
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Get the plugin</h3>
        <p className="text-muted-foreground">In Claude Code, add the marketplace from GitHub or from this checkout, install the plugin, and enter the token when it asks.</p>
        <CopyLine label="marketplace command" text="/plugin marketplace add Krister-Johansson/handoff" />
        <CopyLine label="local marketplace command" text={`/plugin marketplace add ${checkout}`} />
        <CopyLine label="install command" text="/plugin install handoff@handoff" />
        <p className="text-muted-foreground">To hear about questions, failed runs and reviews while you work, start Claude Code with channels:</p>
        <CopyLine label="channels command" text="claude --channels plugin:handoff@handoff" />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Other ways to connect</h3>
        <p className="text-muted-foreground">Without the plugin, add the MCP server by hand. You get the tools, but no messages while you work.</p>
        <CopyLine label="mcp add command" text={`claude mcp add --transport http handoff ${origin}/api/mcp --header "Authorization: Bearer ${token}"`} />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Paste this into your agent</h3>
        <CopyLine label="starter prompt" text={STARTER_PROMPT} />
      </section>
    </div>
  );
}

/**
 * Connect Claude Code to handoff. Turning agent connections on creates a token in a file on this
 * machine; agents send it to /api/mcp. Turning them off deletes it.
 */
export function AgentConnection({ origin, checkout, initialToken }: { origin: string; checkout: string; initialToken: string | undefined }) {
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
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="agent-connections">Enable agent connections</Label>
          <span className="text-xs text-muted-foreground">{token ? "On. Agents with the token can use handoff's tools." : "Off"}</span>
        </div>
        <Switch id="agent-connections" checked={Boolean(token)} disabled={pending} onCheckedChange={toggle} />
      </div>
      {token && (
        <>
          <section className="flex flex-col gap-2">
            <h3 className="font-medium">Token</h3>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <CopyLine label="token" text={token} />
              </div>
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={regenerate}>
                <RefreshCwIcon data-icon="inline-start" />
                Regenerate
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Kept in a file on this machine, not in the database. Regenerating disconnects agents that use the old token.</p>
          </section>
          <Instructions origin={origin} checkout={checkout} token={token} />
        </>
      )}
    </div>
  );
}
