"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel, FieldTitle } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { sendReview, type ReviewOption, type SentComment } from "./send-review";

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
