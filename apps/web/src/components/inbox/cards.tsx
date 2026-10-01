"use client";

import Link from "next/link";
import { useActionState, useState, useTransition, type ReactNode } from "react";
import { CircleXIcon, ClipboardCheckIcon, ExternalLinkIcon, GitPullRequestIcon, MessageCircleQuestionIcon, RepeatIcon, SquareIcon, WrenchIcon, type LucideIcon } from "lucide-react";
import { answerAction, cancelAction, repairAction, resolveLoopAction, type InboxActionState } from "@/app/inbox/actions";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatAgo } from "@/lib/format";
import { reviewPath, runPath } from "@/lib/paths";
import { cn } from "@/lib/utils";

const REASONS: Record<string, string> = {
  needs_input: "A node asked a question",
  loop_exhausted: "A retry loop ran out of attempts",
  approval: "Approval requested",
};

type Tone = "neutral" | "active" | "attention" | "danger" | "success";

const TILE: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  active: "bg-active-bg text-active",
  attention: "bg-attention-bg text-attention",
  danger: "bg-danger-bg text-danger",
  success: "bg-success-bg text-success",
};

const TAG: Record<Tone, string> = {
  neutral: "border-border text-muted-foreground",
  active: "border-transparent bg-active-bg text-active",
  attention: "border-transparent bg-attention-bg text-attention",
  danger: "border-transparent bg-danger-bg text-danger",
  success: "border-transparent bg-success-bg text-success",
};

/** The run an item belongs to, as every card names it. */
type RunRef = { runId: string; projectId: string; task: string; projectName: string };

/** An inbox item: an icon tile in the item's tone beside what it is about, what it asks, and what to do. */
function InboxCard({ icon: Icon, tone, children }: { icon: LucideIcon; tone: Tone; children: ReactNode }) {
  return (
    <article className="grid grid-cols-[36px_minmax(0,1fr)] gap-3.5 rounded-xl bg-card px-[18px] py-4 text-sm text-card-foreground ring-1 ring-border">
      <span aria-hidden className={cn("grid size-9 place-items-center rounded-[9px] [&_svg]:size-4", TILE[tone])}>
        <Icon />
      </span>
      <div className="flex min-w-0 flex-col">{children}</div>
    </article>
  );
}

/** How long ago something happened. The server and the browser may disagree by a minute, which is fine. */
function When({ prefix, at }: { prefix: string; at: Date | string | null | undefined }) {
  if (!at) return null;
  const date = new Date(at);
  return (
    <span className="ml-auto whitespace-nowrap" title={date.toISOString()} suppressHydrationWarning>
      {prefix} {formatAgo(date)}
    </span>
  );
}

/**
 * The line above a card's title: what kind of item it is, then its project and run (left out on the
 * run page, which is already about that run), the node it came from, and when.
 */
function CardContext({ tag, tone = "neutral", item, compact, node, when }: { tag: string; tone?: Tone; item: RunRef; compact: boolean; node?: string; when?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className={cn("inline-flex h-5 items-center rounded-[5px] border px-[7px] text-[11px] font-medium whitespace-nowrap", TAG[tone])}>{tag}</span>
      {!compact && (
        <>
          <Link href={`/projects/${item.projectId}`} className="hover:text-foreground hover:underline hover:underline-offset-3">
            {item.projectName}
          </Link>
          <span aria-hidden>·</span>
          <Link href={runPath(item.projectId, item.runId)} className="max-w-full min-w-0 truncate hover:text-foreground hover:underline hover:underline-offset-3">
            {item.task}
          </Link>
        </>
      )}
      {node && (
        <>
          {!compact && <span aria-hidden>·</span>}
          <span className="font-mono">{node}</span>
        </>
      )}
      {when}
    </div>
  );
}

function CardTitle({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return <h3 className={cn("mt-[3px] leading-[1.35] break-words", mono ? "font-mono text-[13px] font-medium" : "text-[15px] font-semibold")}>{children}</h3>;
}

function CardActions({ children }: { children: ReactNode }) {
  return <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>;
}

function OpenRun({ item }: { item: RunRef }) {
  return (
    <Button variant="ghost" asChild>
      <Link href={runPath(item.projectId, item.runId)}>Open the run</Link>
    </Button>
  );
}

export type QuestionItem = {
  id: string;
  question: string;
  options: string[];
  runId: string;
  projectId: string;
  task: string;
  nodeKey: string;
  projectName: string;
  reason: string;
  context?: Record<string, unknown>;
  createdAt?: Date | string;
};

/** A question that asks for a review is answered on the review page, where the person can comment. */
function ReviewLink({ item, compact }: { item: QuestionItem; compact: boolean }) {
  return (
    <InboxCard icon={ClipboardCheckIcon} tone="attention">
      <CardContext tag={REASONS.approval!} item={item} compact={compact} when={<When prefix="asked" at={item.createdAt} />} />
      <CardTitle>{item.question}</CardTitle>
      <CardActions>
        <Button asChild>
          <Link href={reviewPath(item.projectId, item.runId, item.id)}>Open the review</Link>
        </Button>
        {!compact && <OpenRun item={item} />}
      </CardActions>
    </InboxCard>
  );
}

export function QuestionCard({ item, compact = false }: { item: QuestionItem; compact?: boolean }) {
  if (item.context?.review) return <ReviewLink item={item} compact={compact} />;
  return <AnswerCard item={item} compact={compact} />;
}

const quiet = (option: string) => option === "abort" || option === "reject" || option === "changes";

function AnswerCard({ item, compact }: { item: QuestionItem; compact: boolean }) {
  const [state, action, pending] = useActionState(answerAction, {} as InboxActionState);
  const loop = item.reason === "loop_exhausted";
  return (
    <InboxCard icon={loop ? RepeatIcon : MessageCircleQuestionIcon} tone={loop ? "attention" : "active"}>
      <CardContext tag={REASONS[item.reason] ?? item.reason} item={item} compact={compact} node={item.nodeKey} when={<When prefix="asked" at={item.createdAt} />} />
      <CardTitle>{item.question}</CardTitle>
      <form action={action} className="mt-2.5 flex flex-col gap-3">
        <input type="hidden" name="questionId" value={item.id} />
        <input type="hidden" name="runId" value={item.runId} />
        {item.options.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {item.options.map((option) => (
              <Button key={option} type="submit" name="option" value={option} variant={quiet(option) ? "outline" : "default"} disabled={pending}>
                {option}
              </Button>
            ))}
          </div>
        )}
        <Field data-invalid={state.error ? true : undefined}>
          <FieldLabel htmlFor={`answer-${item.id}`}>{item.options.length ? "Details (optional)" : "Answer"}</FieldLabel>
          <Textarea id={`answer-${item.id}`} name="answer" rows={2} placeholder="Your answer goes to the node that asked." />
          {state.error && <FieldError>{state.error}</FieldError>}
        </Field>
        {item.options.length === 0 && (
          <div>
            <Button type="submit" disabled={pending}>
              Send answer
            </Button>
          </div>
        )}
      </form>
    </InboxCard>
  );
}

export type FailedRunItem = {
  runId: string;
  projectId: string;
  task: string;
  projectName: string;
  executionId: string;
  nodeKey: string;
  attempt: number;
  error: { code: string; message: string } | null;
  finishedAt?: Date | string | null;
};

export function FailedRunCard({ item, compact = false }: { item: FailedRunItem; compact?: boolean }) {
  const [repairState, repair, repairing] = useActionState(repairAction, {} as InboxActionState);
  const [cancelState, cancel, cancelling] = useActionState(cancelAction, {} as InboxActionState);
  const error = repairState.error ?? cancelState.error;
  const [first = "", ...rest] = (item.error?.message ?? "").split("\n");
  const output = rest.join("\n").trim();
  return (
    <InboxCard icon={CircleXIcon} tone="danger">
      <CardContext tag={`failed at ${item.nodeKey}`} tone="danger" item={item} compact={compact} when={<When prefix="failed" at={item.finishedAt} />} />
      <CardTitle mono>{item.error ? `${item.error.code}: ${first}` : "failed"}</CardTitle>
      <div className="mt-2.5 flex flex-col gap-3">
        {output && <pre className="max-h-32 overflow-auto rounded-md border bg-terminal px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-terminal-foreground">{output}</pre>}
        <form id={`repair-${item.executionId}`} action={repair}>
          <input type="hidden" name="executionId" value={item.executionId} />
          <input type="hidden" name="runId" value={item.runId} />
          <Field>
            <FieldLabel htmlFor={`note-${item.executionId}`}>Note for the retry</FieldLabel>
            <Input id={`note-${item.executionId}`} name="note" placeholder="What changed, or what to try instead" />
            <FieldDescription>Repair re-runs {item.nodeKey} as attempt {item.attempt + 1}; everything before it is kept.</FieldDescription>
          </Field>
        </form>
        {error && <FieldError>{error}</FieldError>}
      </div>
      <CardActions>
        <Button type="submit" form={`repair-${item.executionId}`} disabled={repairing}>
          <WrenchIcon data-icon="inline-start" />
          Repair {item.nodeKey}
        </Button>
        <form action={cancel}>
          <input type="hidden" name="runId" value={item.runId} />
          <Button type="submit" variant="outline" disabled={cancelling}>
            Cancel run
          </Button>
        </form>
        {!compact && <OpenRun item={item} />}
      </CardActions>
    </InboxCard>
  );
}

export type StuckRunItem = RunRef & { nodeKey: string; loop: string; attempts: number; finishedAt: Date | string | null };

/**
 * A run that stopped because a loop used all its attempts: no step failed, so it asks for a decision
 * instead of a repair. Another round sends the work back once more, going on takes the step's forward
 * edges as if it approved, and stopping cancels the run.
 */
export function StuckRunCard({ item }: { item: StuckRunItem }) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const decide = (action: "retry" | "continue" | "stop") =>
    start(async () => {
      const result = await resolveLoopAction({ runId: item.runId, action });
      setError(result.ok ? undefined : result.error);
    });
  return (
    <InboxCard icon={RepeatIcon} tone="attention">
      <CardContext tag="ran out of rounds" tone="attention" item={item} compact={false} when={<When prefix="stopped" at={item.finishedAt} />} />
      <CardTitle>{`${item.nodeKey} sent the work back ${item.attempts} times, as often as ${item.loop} allows.`}</CardTitle>
      <p className="mt-1 text-[13px] text-muted-foreground">No step failed. Decide how to go on.</p>
      <CardActions>
        <Button type="button" disabled={pending} onClick={() => decide("continue")}>
          Go on as if approved
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => decide("retry")}>
          <RepeatIcon data-icon="inline-start" />
          Another round
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => decide("stop")}>
          Stop the run
        </Button>
      </CardActions>
      {error && <FieldError className="mt-2">{error}</FieldError>}
    </InboxCard>
  );
}

export type PullRequestItem = RunRef & { executionId: string; number: number; url: string | null; ci: string | null; branch: string };

const CI: Record<string, { label: string; dot: string }> = {
  success: { label: "CI passing", dot: "bg-success-dot" },
  failure: { label: "CI failing", dot: "bg-danger-dot" },
};

/** A pull request whose PR node waits for an approving review on GitHub. */
export function PullRequestCard({ item }: { item: PullRequestItem }) {
  const ci = item.ci ? CI[item.ci] : undefined;
  return (
    <InboxCard icon={GitPullRequestIcon} tone="success">
      <CardContext tag="PR to review on GitHub" item={item} compact={false} />
      <CardTitle>
        <span className="font-mono text-[13px] font-medium text-muted-foreground">#{item.number}</span> {item.task}
      </CardTitle>
      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {ci && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("size-[7px] rounded-full", ci.dot)} />
            {ci.label}
          </span>
        )}
        <span className="font-mono">{item.branch}</span>
        <span>The run goes on once the PR is approved.</span>
      </div>
      <CardActions>
        {item.url && (
          <Button asChild>
            <a href={item.url} target="_blank" rel="noreferrer">
              <ExternalLinkIcon data-icon="inline-start" />
              Review on GitHub
            </a>
          </Button>
        )}
        <OpenRun item={item} />
      </CardActions>
    </InboxCard>
  );
}

export function CancelRunButton({ runId }: { runId: string }) {
  const [state, cancel, cancelling] = useActionState(cancelAction, {} as InboxActionState);
  return (
    <form action={cancel} className="flex items-center gap-2">
      <input type="hidden" name="runId" value={runId} />
      <Button type="submit" variant="outline" size="sm" disabled={cancelling} className="text-danger hover:bg-danger-bg hover:text-danger dark:hover:bg-danger-bg">
        <SquareIcon data-icon="inline-start" />
        Cancel run
      </Button>
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
