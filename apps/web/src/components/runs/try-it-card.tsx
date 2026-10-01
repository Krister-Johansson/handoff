"use client";

import { useState, useTransition } from "react";
import { ExternalLinkIcon, PlayIcon, RotateCwIcon } from "lucide-react";
import { answerReviewAction, restartTryItAction } from "@/app/inbox/actions";
import { TerminalOutput } from "@/components/terminal-output";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** What a Try it question shows about the run's app: its address while it runs, or why it did not start. */
type Preview = { id?: string; url?: string; status: "running" | "failed"; error?: string };

export type TryItQuestion = { id: string; runId: string; question: string; context?: Record<string, unknown> };

type Check = { works?: boolean; note: string };

/** One acceptance criterion with Works and Doesn't work, and what is wrong when it does not. */
function CriterionRow({ item, index, check, onChange }: { item: string; index: number; check: Check; onChange: (next: Check) => void }) {
  return (
    <li className="flex flex-col gap-2 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 text-sm">{item}</span>
        <div className="flex gap-1.5">
          <Button type="button" size="sm" variant={check.works === true ? "default" : "outline"} aria-pressed={check.works === true} onClick={() => onChange({ ...check, works: true })}>
            Works
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn(check.works === false && "border-danger text-danger")}
            aria-pressed={check.works === false}
            onClick={() => onChange({ ...check, works: false })}
          >
            Doesn&apos;t work
          </Button>
        </div>
      </div>
      {check.works === false && (
        <Field>
          <FieldLabel htmlFor={`criterion-${index}`} className="sr-only">
            What is wrong?
          </FieldLabel>
          <Input id={`criterion-${index}`} placeholder="What is wrong?" value={check.note} onChange={(e) => onChange({ ...check, note: e.target.value })} />
        </Field>
      )}
    </li>
  );
}

/** The run's app: a link to open it while it runs, or why it did not start, and a way to start it again. */
function AppStatus({ preview, pending, onRestart }: { preview: Preview; pending: boolean; onRestart: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {preview.status === "running" && preview.url && (
          <Button asChild size="sm">
            <a href={preview.url} target="_blank" rel="noreferrer">
              <ExternalLinkIcon data-icon="inline-start" />
              Open the app
              <span className="font-mono text-xs opacity-80">{preview.url.replace(/^https?:\/\//, "")}</span>
            </a>
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onRestart}>
          <RotateCwIcon data-icon="inline-start" />
          Start the app again
        </Button>
      </div>
      {preview.status === "failed" && <TerminalOutput text={preview.error ?? "The app did not start."} />}
    </div>
  );
}

/**
 * A Try it gate's question: the run's app to open, and its acceptance criteria to check one by one.
 * Approve needs every item to work; any item that does not sends the work back with what is wrong.
 */
export function TryItCard({ item }: { item: TryItQuestion }) {
  const acceptance = Array.isArray(item.context?.acceptance) ? (item.context.acceptance as string[]) : [];
  const preview = (item.context?.preview ?? { status: "failed", error: "The app has not started yet." }) as Preview;
  const [checks, setChecks] = useState<Check[]>(() => acceptance.map(() => ({ note: "" })));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const allWork = checks.every((c) => c.works === true);
  const failed = acceptance.flatMap((quote, i) => (checks[i]?.works === false ? [{ quote, body: checks[i]!.note.trim() || "Does not work." }] : []));
  const run = (action: () => Promise<{ ok?: boolean; error?: string }>) =>
    start(async () => {
      const result = await action();
      setError(result.ok ? undefined : result.error);
    });
  const answer = (option: "approve" | "changes") => run(() => answerReviewAction({ questionId: item.id, runId: item.runId, option, note: note.trim(), comments: option === "changes" ? failed : [] }));
  return (
    <Card className="gap-3 py-4">
      <CardContent className="flex flex-col gap-3.5 px-5">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="inline-grid size-7 place-items-center rounded-[7px] bg-attention-bg text-attention [&_svg]:size-3.5">
            <PlayIcon />
          </span>
          <h2 className="text-[15px] font-semibold">Try it</h2>
        </div>
        <p className="text-sm text-muted-foreground">{item.question}</p>
        <AppStatus preview={preview} pending={pending} onRestart={() => run(() => restartTryItAction({ questionId: item.id, runId: item.runId }))} />
        {acceptance.length > 0 && (
          <ul aria-label="Acceptance criteria" className="flex flex-col divide-y border-y">
            {acceptance.map((criterion, i) => (
              <CriterionRow key={criterion} item={criterion} index={i} check={checks[i]!} onChange={(next) => setChecks((all) => all.map((c, j) => (j === i ? next : c)))} />
            ))}
          </ul>
        )}
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor={`try-note-${item.id}`}>Note (optional)</FieldLabel>
          <Textarea id={`try-note-${item.id}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything else the coder should know." />
          {error && <FieldError>{error}</FieldError>}
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending || !allWork} onClick={() => answer("approve")}>
            Approve
          </Button>
          <Button type="button" variant="outline" disabled={pending || (failed.length === 0 && !note.trim())} onClick={() => answer("changes")}>
            Send back
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
