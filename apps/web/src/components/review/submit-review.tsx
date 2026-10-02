"use client";

import { useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { answerReviewAction } from "@/app/inbox/actions";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel, FieldTitle } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

export type ReviewOption = "changes" | "approve" | "fix";

type SentComment = {
  quote: string;
  body: string;
  path?: string;
  line?: number;
  endLine?: number;
  side?: "old" | "new";
};

/** Whether an error is Next's own: the redirect a server action ends with, after Next has started the navigation. */
export function isNextNavigation(error: unknown) {
  try {
    unstable_rethrow(error);
    return false;
  } catch {
    return true;
  }
}

const NOTHING_TO_FIX = "Add a comment or an overall comment first, so there is something to fix.";

type Review = {
  questionId: string;
  runId: string;
  option: ReviewOption;
  note: string;
  comments: SentComment[];
  /** Called as the review is sent, to drop the kept draft, and again if sending failed, to keep it. */
  onSending?: (() => void) | undefined;
  onFailed?: (() => void) | undefined;
};

/**
 * Sends a review, as the Send review button and page_submit_review both do. Request changes and
 * approve after fixes need a comment or an overall comment. Resolves to why the review was not sent;
 * once sent, the action redirects to the run page, which reaches the caller as Next's redirect error.
 */
export async function sendReview({ questionId, runId, option, note, comments, onSending, onFailed }: Review): Promise<string | undefined> {
  if (option !== "approve" && !note.trim() && comments.length === 0) return NOTHING_TO_FIX;
  // A sent review redirects to the run, so the draft goes first and comes back if the send fails.
  onSending?.();
  const result = await answerReviewAction({ questionId, runId, option, note: note.trim(), comments });
  if (result && "error" in result && result.error) {
    onFailed?.();
    return result.error;
  }
  return undefined;
}

/** What was sent, in words, for the page tool's answer. */
function sentText(option: ReviewOption, target: string, comments: number, note: string) {
  const parts = [comments > 0 ? `${comments} ${comments === 1 ? "comment" : "comments"}` : undefined, note.trim() ? "the overall comment" : undefined].filter(Boolean).join(" and ");
  if (option === "approve") return `Approved${parts ? ` with ${parts}` : ""}. The run page opens.`;
  if (option === "changes") return `Requested changes from ${target} with ${parts}. The run page opens.`;
  return `Approved after fixes: sent ${parts} back to ${target}. The run page opens.`;
}

/**
 * page_submit_review on either review page: sends the review and answers with what was sent, or
 * throws why it was not. Next's redirect after a successful send counts as sent.
 */
export async function submitReviewTool(review: Review & { target: string }): Promise<string> {
  try {
    const error = await sendReview(review);
    if (error) throw new Error(error);
  } catch (error) {
    if (!isNextNavigation(error)) throw error;
  }
  return sentText(review.option, review.target, review.comments.length, review.note);
}

const CHOICES: {
  value: ReviewOption;
  title: string;
  describe: (target: string) => string;
}[] = [
  {
    value: "changes",
    title: "Request changes",
    describe: (target) => `Send your comments back to ${target}. You review again when it returns.`,
  },
  {
    value: "approve",
    title: "Approve",
    describe: () => "Let the run go on to the next step.",
  },
  {
    value: "fix",
    title: "Approve after fixes",
    describe: (target) => `Send your comments back to ${target}. When the fixed work returns, the run goes on without asking you.`,
  },
];

/**
 * How a person finishes a review: an overall comment and one of three choices. Request changes and
 * approve after fixes both send the comments back; the second lets the fixed work through the gate.
 */
type SubmitProps = {
  questionId: string;
  runId: string;
  target: string;
  comments: SentComment[];
  note: string;
  setNote: (note: string) => void;
  /** Called as the review is sent, to drop the kept draft, and again if sending failed, to keep it. */
  onSending?: () => void;
  onFailed?: () => void;
};

export function SubmitReview({ questionId, runId, target, comments, note, setNote, onSending, onFailed }: SubmitProps) {
  const [option, setOption] = useState<ReviewOption>();
  const [error, setError] = useState<string>();
  const [pending, startSubmit] = useTransition();

  const send = () => {
    if (!option) return;
    setError(undefined);
    startSubmit(async () => {
      const failed = await sendReview({ questionId, runId, option, note, comments, onSending, onFailed });
      if (failed) startSubmit(() => setError(failed));
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <Field className="gap-1.5">
        <FieldLabel htmlFor="review-note" className="text-[13px]">
          Overall comment
        </FieldLabel>
        <Textarea id="review-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional. Sent with your comments." className="bg-subtle" />
        {comments.length > 0 && <FieldDescription className="text-xs">{`${comments.length} ${comments.length === 1 ? "comment" : "comments"} will be sent with it.`}</FieldDescription>}
      </Field>
      <RadioGroup value={option ?? ""} onValueChange={(value) => setOption(value as ReviewOption)} aria-label="Review result" className="gap-1.5">
        {CHOICES.map((choice) => (
          <FieldLabel
            key={choice.value}
            htmlFor={`review-${choice.value}`}
            className="has-data-checked:border-input has-data-checked:bg-muted *:data-[slot=field]:px-3 *:data-[slot=field]:py-2.5 dark:has-data-checked:border-input dark:has-data-checked:bg-muted"
          >
            <Field orientation="horizontal" className="gap-2.5">
              <RadioGroupItem value={choice.value} id={`review-${choice.value}`} />
              <FieldContent>
                <FieldTitle className="text-[13px]">{choice.title}</FieldTitle>
                <FieldDescription className="text-xs">{choice.describe(target)}</FieldDescription>
              </FieldContent>
            </Field>
          </FieldLabel>
        ))}
      </RadioGroup>
      {error && <FieldError>{error}</FieldError>}
      <Button type="button" disabled={!option || pending} onClick={send}>
        Send review
      </Button>
    </div>
  );
}
