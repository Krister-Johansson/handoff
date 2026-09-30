"use client";

import Link from "next/link";
import { useActionState } from "react";
import { answerAction, cancelAction, repairAction, type InboxActionState } from "@/app/inbox/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const REASONS: Record<string, string> = {
  needs_input: "A node asked a question",
  loop_exhausted: "A retry loop ran out of attempts",
  approval: "Approval requested",
};

export type QuestionItem = { id: string; question: string; options: string[]; runId: string; task: string; nodeKey: string; projectName: string; reason: string };

export function QuestionCard({ item, compact = false }: { item: QuestionItem; compact?: boolean }) {
  const [state, action, pending] = useActionState(answerAction, {} as InboxActionState);
  return (
    <Card>
      <CardHeader>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{REASONS[item.reason] ?? item.reason}</Badge>
          {!compact && (
            <Link href={`/runs/${item.runId}`} className="truncate hover:underline">
              {item.projectName}: {item.task}
            </Link>
          )}
        </CardDescription>
        <CardTitle className="text-base leading-snug">{item.question}</CardTitle>
      </CardHeader>
      <form action={action}>
        <CardContent>
          <input type="hidden" name="questionId" value={item.id} />
          <input type="hidden" name="runId" value={item.runId} />
          <FieldGroup>
            <Field data-invalid={state.error ? true : undefined}>
              <FieldLabel htmlFor={`answer-${item.id}`}>{item.options.length ? "Details (optional)" : "Answer"}</FieldLabel>
              <Textarea id={`answer-${item.id}`} name="answer" rows={3} placeholder="Your answer goes to the node that asked." />
              {state.error && <FieldError>{state.error}</FieldError>}
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2 pt-4">
          {item.options.length > 0 ? (
            item.options.map((option) => (
              <Button key={option} type="submit" name="option" value={option} variant={option === "abort" || option === "reject" || option === "changes" ? "outline" : "default"} disabled={pending}>
                {option}
              </Button>
            ))
          ) : (
            <Button type="submit" disabled={pending}>
              Send answer
            </Button>
          )}
        </CardFooter>
      </form>
    </Card>
  );
}

export type FailedRunItem = { runId: string; task: string; projectName: string; executionId: string; nodeKey: string; attempt: number; error: { code: string; message: string } | null };

export function FailedRunCard({ item, compact = false }: { item: FailedRunItem; compact?: boolean }) {
  const [repairState, repair, repairing] = useActionState(repairAction, {} as InboxActionState);
  const [cancelState, cancel, cancelling] = useActionState(cancelAction, {} as InboxActionState);
  const error = repairState.error ?? cancelState.error;
  return (
    <Card>
      <CardHeader>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <Badge variant="destructive">failed at {item.nodeKey}</Badge>
          {!compact && (
            <Link href={`/runs/${item.runId}`} className="truncate hover:underline">
              {item.projectName}: {item.task}
            </Link>
          )}
        </CardDescription>
        <CardTitle className="font-mono text-sm leading-snug">{item.error ? `${item.error.code}: ${item.error.message}` : "failed"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form id={`repair-${item.executionId}`} action={repair}>
          <input type="hidden" name="executionId" value={item.executionId} />
          <input type="hidden" name="runId" value={item.runId} />
          <Field>
            <FieldLabel htmlFor={`note-${item.executionId}`}>Note for the retry</FieldLabel>
            <Input id={`note-${item.executionId}`} name="note" placeholder="What changed, or what to try instead" />
            <FieldDescription>Repair re-runs {item.nodeKey} as attempt {item.attempt + 1}; everything before it is kept.</FieldDescription>
          </Field>
        </form>
        {error && <FieldError className="mt-2">{error}</FieldError>}
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button type="submit" form={`repair-${item.executionId}`} disabled={repairing}>
          Repair {item.nodeKey}
        </Button>
        <form action={cancel}>
          <input type="hidden" name="runId" value={item.runId} />
          <Button type="submit" variant="outline" disabled={cancelling}>
            Cancel run
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}

export function CancelRunButton({ runId }: { runId: string }) {
  const [state, cancel, cancelling] = useActionState(cancelAction, {} as InboxActionState);
  return (
    <form action={cancel} className="flex items-center gap-2">
      <input type="hidden" name="runId" value={runId} />
      <Button type="submit" variant="outline" size="sm" disabled={cancelling}>
        Cancel run
      </Button>
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
