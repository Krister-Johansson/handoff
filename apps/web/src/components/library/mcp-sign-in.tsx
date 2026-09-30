"use client";

import { useActionState } from "react";
import { KeyRoundIcon, LogOutIcon } from "lucide-react";
import { signInMcpAction, signOutMcpAction, type SignInState } from "@/app/library/mcp-oauth-actions";
import { StatusBadge } from "@/components/runs/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field";

/** `expiresAt` is already formatted for display, on the server. */
export type SignInStatus = { connected: boolean; expiresAt?: string; refreshable?: boolean; scope?: string };

function Expiry({ status }: { status: SignInStatus }) {
  if (!status.expiresAt) return <p>The access token does not expire.</p>;
  const at = status.expiresAt;
  return <p>{status.refreshable ? `The access token expires ${at} and is refreshed when a run needs it.` : `The access token expires ${at}. Sign in again after that.`}</p>;
}

/**
 * OAuth sign-in for an http MCP server. The dashboard runs the sign-in in the browser; the tokens go
 * to the OAuth store on this machine, never to the database, and runs read them from there.
 */
export function McpSignIn({ name, status, error, signedIn }: { name: string; status: SignInStatus; error?: string; signedIn?: boolean }) {
  const [state, signIn, pending] = useActionState(signInMcpAction, {} as SignInState);
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>OAuth sign-in</CardTitle>
        <CardDescription>Tokens are kept in handoff&apos;s OAuth store on this machine, not in the database.</CardDescription>
        <CardAction>{status.connected ? <StatusBadge status="succeeded" label="Signed in" /> : <StatusBadge status="waiting" label="Not signed in" />}</CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {signedIn && status.connected && <p>Signed in to {name}.</p>}
        {status.connected ? (
          <>
            <Expiry status={status} />
            {status.scope && (
              <p>
                Scope: <span className="font-mono">{status.scope}</span>
              </p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">Runs that use {name} fail before Claude starts until someone signs in.</p>
        )}
        {(state.error ?? error) && <FieldError>{state.error ?? error}</FieldError>}
        <div className="flex flex-wrap gap-2">
          <form action={signIn}>
            <input type="hidden" name="name" value={name} />
            <Button type="submit" size="sm" disabled={pending}>
              <KeyRoundIcon data-icon="inline-start" />
              {pending ? "Opening sign-in" : status.connected ? "Sign in again" : "Sign in"}
            </Button>
          </form>
          {status.connected && (
            <form action={signOutMcpAction}>
              <input type="hidden" name="name" value={name} />
              <Button type="submit" size="sm" variant="outline">
                <LogOutIcon data-icon="inline-start" />
                Sign out
              </Button>
            </form>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
