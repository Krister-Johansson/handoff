"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ShieldQuestionIcon } from "lucide-react";
import { answerPermissionAction } from "@/app/inbox/actions";
import { TerminalOutput } from "@/components/terminal-output";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { runPath } from "@/lib/paths";
import { describePermission, ruleFor } from "@/lib/permission";

export type PermissionRequestView = { id: string; runId: string; nodeKey: string; toolName: string; input: Record<string, unknown> };

/**
 * A tool call a step's allow rules do not cover, while the step waits for an answer: what it wants to
 * do, and Allow once, Always allow (which adds the rule to the node for later runs) or Deny with a note.
 */
export function PermissionCard({ request, run }: { request: PermissionRequestView; run?: { projectId: string; projectName: string; task: string } }) {
  const { action, detail } = describePermission(request.toolName, request.input);
  const rule = ruleFor(request.toolName, request.input);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const answer = (input: { decision: "once" } | { decision: "always"; rule: string } | { decision: "deny"; message?: string }) =>
    start(async () => {
      const result = await answerPermissionAction({ id: request.id, runId: request.runId, ...input });
      setError(result.ok ? undefined : result.error);
    });
  return (
    <Card className="gap-3 border-attention-dot/35 py-4">
      <CardContent className="flex flex-col gap-3 px-5">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="inline-grid size-7 place-items-center rounded-[7px] bg-attention-bg text-attention [&_svg]:size-3.5">
            <ShieldQuestionIcon />
          </span>
          <h3 className="text-[15px] font-semibold">
            {request.nodeKey} {action}
          </h3>
        </div>
        {run && (
          <p className="text-xs text-muted-foreground">
            {run.projectName} ·{" "}
            <Link href={runPath(run.projectId, request.runId)} className="hover:text-foreground hover:underline">
              {run.task}
            </Link>
          </p>
        )}
        <p className="text-sm text-muted-foreground">The step waits for your answer. Its allow rules do not cover this call.</p>
        {detail && <TerminalOutput text={detail} label="request" />}
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor={`permission-note-${request.id}`}>Note for Claude (optional)</FieldLabel>
          <Input id={`permission-note-${request.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why not, or what to do instead" />
          {error && <FieldError>{error}</FieldError>}
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending} onClick={() => answer({ decision: "once" })}>
            Allow once
          </Button>
          <Button type="button" variant="outline" disabled={pending} aria-label={`Always allow ${rule}`} onClick={() => answer({ decision: "always", rule })}>
            Always allow <span className="font-mono text-xs">{rule}</span>
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => answer(note.trim() ? { decision: "deny", message: note.trim() } : { decision: "deny" })}>
            Deny
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
