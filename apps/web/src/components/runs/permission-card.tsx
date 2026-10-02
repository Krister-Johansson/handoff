"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { ShieldQuestionIcon } from "lucide-react";
import { answerPermissionAction } from "@/app/inbox/actions";
import { TerminalOutput } from "@/components/terminal-output";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatAgo } from "@/lib/format";
import { runPath } from "@/lib/paths";
import { useCardPlace } from "@/components/inbox/card-place";
import { describePermission } from "@handoff/core";
import { ruleFor } from "@/lib/permission";

export type PermissionRequestView = { id: string; runId: string; nodeKey: string; toolName: string; input: Record<string, unknown>; createdAt: Date | string };

/**
 * A tool call a step's allow rules do not cover, while the step waits for an answer: what it wants to
 * do, and Allow once, Always allow (which adds the rule to the node for later runs, when a rule is safe to offer) or Deny with a note.
 */
export function PermissionCard({ request, run }: { request: PermissionRequestView; run?: { projectId: string; projectName: string; task: string } }) {
  const { action, detail } = describePermission(request.toolName, request.input);
  const inProject = useCardPlace() === "project";
  const asked = new Date(request.createdAt);
  const rule = ruleFor(request.toolName, request.input);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const answer = (input: { decision: "once" } | { decision: "always"; rule: string } | { decision: "deny"; message?: string }) =>
    start(async () => {
      const result = await answerPermissionAction({ id: request.id, runId: request.runId, ...input });
      setError(result.ok ? undefined : result.error);
    });
  // Allow once and Deny submit the form, so a browser agent can fill it as a WebMCP tool; the person presses one.
  const pressed = useRef<"once" | "deny">(undefined);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const decision = (submitter?.value as "once" | "deny" | undefined) ?? pressed.current;
    if (decision === "once") answer({ decision: "once" });
    else if (decision === "deny") answer(note.trim() ? { decision: "deny", message: note.trim() } : { decision: "deny" });
  };
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
        <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
          {run && (
            <>
              {!inProject && <span>{run.projectName} ·</span>}
              <Link href={runPath(run.projectId, request.runId)} className="min-w-0 truncate hover:text-foreground hover:underline">
                {run.task}
              </Link>
            </>
          )}
          <span className="ml-auto whitespace-nowrap" title={asked.toISOString()} suppressHydrationWarning>
            asked {formatAgo(asked)}
          </span>
        </p>
        <p className="text-sm text-muted-foreground">The step waits for your answer. Its allow rules do not cover this call.</p>
        {detail && <TerminalOutput text={detail} label="request" />}
        <form
          onSubmit={submit}
          className="flex flex-col gap-3"
          toolname={`answer_permission_${request.id}`}
          tooldescription={`Answers ${request.nodeKey} ${action}: Allow once or Deny with a note. The person presses the button.`}
        >
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={`permission-note-${request.id}`}>Note for Claude (optional)</FieldLabel>
            <Input
              id={`permission-note-${request.id}`}
              name="message"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              // Enter would submit with the first button, Allow once.
              onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
              placeholder="Why not, or what to do instead"
              toolparamdescription="For a denial: why not, or what the step should do instead"
            />
            {error && <FieldError>{error}</FieldError>}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="decision" value="once" disabled={pending} onClick={() => (pressed.current = "once")}>
              Allow once
            </Button>
            {rule && (
              <Button type="button" variant="outline" disabled={pending} aria-label={`Always allow ${rule}`} onClick={() => answer({ decision: "always", rule })}>
                Always allow <span className="font-mono text-xs">{rule}</span>
              </Button>
            )}
            <Button type="submit" name="decision" value="deny" variant="outline" disabled={pending} onClick={() => (pressed.current = "deny")}>
              Deny
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
