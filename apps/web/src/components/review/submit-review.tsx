"use client";

import { useState, useTransition } from "react";
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
export function SubmitReview({ questionId, runId, target, comments }: { questionId: string; runId: string; target: string; comments: SentComment[] }) {
  const [note, setNote] = useState("");
  const [option, setOption] = useState<ReviewOption>();
  const [error, setError] = useState<string>();
  const [pending, startSubmit] = useTransition();

  const send = () => {
    if (!option) return;
    if (option !== "approve" && !note.trim() && comments.length === 0) {
      setError("Add a comment or an overall comment first, so there is something to fix.");
      return;
    }
    setError(undefined);
    startSubmit(async () => {
      const result = await answerReviewAction({
        questionId,
        runId,
        option,
        note: note.trim(),
        comments,
      });
      if (result && "error" in result && result.error) setError(result.error);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="review-note">Overall comment</FieldLabel>
        <Textarea id="review-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional. Sent with your line comments." />
        {comments.length > 0 && <FieldDescription>{`${comments.length} ${comments.length === 1 ? "comment" : "comments"} will be sent with it.`}</FieldDescription>}
      </Field>
      <RadioGroup value={option ?? ""} onValueChange={(value) => setOption(value as ReviewOption)} aria-label="Review result">
        {CHOICES.map((choice) => (
          <FieldLabel key={choice.value} htmlFor={`review-${choice.value}`}>
            <Field orientation="horizontal">
              <RadioGroupItem value={choice.value} id={`review-${choice.value}`} />
              <FieldContent>
                <FieldTitle>{choice.title}</FieldTitle>
                <FieldDescription>{choice.describe(target)}</FieldDescription>
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
