"use client";

import { useState, useTransition } from "react";
import { SendIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel, FieldTitle } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { firstSentence, shortLocationOf, type Finding } from "@/lib/findings";
import { countOf, sendReview, type ReviewOption, type SentComment } from "./send-review";

/** What goes back: the Fix now findings when the review has findings, else only the comments. */
const sentWhat = (findings: boolean) => (findings ? "the Fix now findings and your comments" : "your comments");

const CHOICES: {
  value: ReviewOption;
  title: string;
  describe: (target: string, findings: boolean) => string;
}[] = [
  {
    value: "changes",
    title: "Request changes",
    describe: (target, findings) => `Send ${sentWhat(findings)} back to ${target}. You review again when it returns.`,
  },
  {
    value: "approve",
    title: "Approve",
    describe: () => "Let the run go on to the next step.",
  },
  {
    value: "fix",
    title: "Approve after fixes",
    describe: (target, findings) => `Send ${sentWhat(findings)} back to ${target}. When the fixed work returns, the run goes on without asking you.`,
  },
  {
    value: "split",
    title: "Split as proposed",
    describe: (target) => `handoff opens an issue for each later part, and this run builds the first part. ${target} plans it on its own.`,
  },
];

/** The choices a review offers when its question names none: everything but a split. */
const DEFAULT_OPTIONS: ReviewOption[] = ["changes", "approve", "fix"];

/** A Fix now finding with its place in the review, from 0. */
export type PickedFinding = { index: number; finding: Finding };

/**
 * How a person finishes a review: an overall comment and one of three choices. Request changes and
 * approve after fixes both send the Fix now findings and the comments back; the second lets the fixed
 * work through the gate.
 */
type SubmitProps = {
  questionId: string;
  runId: string;
  target: string;
  comments: SentComment[];
  note: string;
  setNote: (note: string) => void;
  /** The code reviewer's Fix now findings; undefined when the review has no findings. */
  findings?: PickedFinding[] | undefined;
  /** Called as the review is sent, to drop the kept draft, and again if sending failed, to keep it. */
  onSending?: () => void;
  onFailed?: () => void;
  /** The answers the gate's question offers; a split offers split and changes. */
  options?: readonly string[] | undefined;
};

/** Under the overall comment: what the chosen answer sends back to the target. */
function sentLine(option: ReviewOption | undefined, target: string, findings: number, comments: number, note: boolean) {
  if (option === "approve") return comments > 0 ? `${countOf(comments, "comment")} will be sent with it.` : `Approve sends nothing back to ${target}.`;
  const parts = [...(findings > 0 ? [countOf(findings, "finding")] : []), ...(comments > 0 ? [countOf(comments, "comment")] : [])].join(" and ");
  if (parts) return <><b className="font-medium text-foreground">{parts}</b>{` will be sent to ${target}.`}</>;
  return note ? `Your overall comment will be sent to ${target}.` : `Nothing will be sent to ${target} yet.`;
}

/** The Fix now findings that go back, each by its file and line and the first sentence of its text. */
function GoesBack({ target, findings }: { target: string; findings: PickedFinding[] }) {
  const title = `Goes back to ${target}`;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-subtle px-3 py-2 text-[12.5px]">
      <span className="flex items-center gap-1.5 font-medium">
        <SendIcon aria-hidden className="size-3.5 text-muted-foreground" />
        {title}
      </span>
      <ul aria-label={title} className="flex flex-col gap-0.5 pl-5">
        {findings.map(({ index, finding }) => (
          <li key={index} className="flex min-w-0 gap-1.5">
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground" title={finding.path}>
              {shortLocationOf(finding)}
            </span>
            <span className="min-w-0 truncate">{firstSentence(finding.body)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Approve with Fix now findings picked: they stay where they are. */
function NotSent({ count }: { count: number }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-attention-dot/40 bg-attention-bg px-3 py-2 text-[12.5px]/[1.45]">
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-attention" />
      <span>
        {`The ${countOf(count, "Fix now finding")} will not be sent.`}
        <span className="mt-0.5 block text-muted-foreground">Approve lets the run go on as it is. Pick Approve after fixes to send them, or set them to Follow-up or Skip.</span>
      </span>
    </div>
  );
}

export function SubmitReview({ questionId, runId, target, comments, note, setNote, findings, onSending, onFailed, options }: SubmitProps) {
  const offered = options?.length ? options : DEFAULT_OPTIONS;
  const choices = CHOICES.filter((choice) => offered.includes(choice.value));
  const [option, setOption] = useState<ReviewOption>();
  const [error, setError] = useState<string>();
  const [pending, startSubmit] = useTransition();
  const fixNow = findings ?? [];
  const unsent = option === "approve" ? fixNow.length : 0;

  const send = () => {
    if (!option) return;
    setError(undefined);
    startSubmit(async () => {
      const failed = await sendReview({ questionId, runId, option, note, comments, findings: findings?.map((f) => f.index).sort((a, b) => a - b), onSending, onFailed });
      if (failed) startSubmit(() => setError(failed));
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <Field className="gap-1.5">
        <FieldLabel htmlFor="review-note" className="text-[13px]">
          Overall comment
        </FieldLabel>
        <Textarea
          id="review-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={findings ? "Optional. Sent with the findings and your comments." : "Optional. Sent with your comments."}
          className="bg-subtle"
        />
        {findings ? (
          <FieldDescription className="text-xs">{sentLine(option, target, fixNow.length, comments.length, note.trim() !== "")}</FieldDescription>
        ) : (
          comments.length > 0 && <FieldDescription className="text-xs">{`${countOf(comments.length, "comment")} will be sent with it.`}</FieldDescription>
        )}
      </Field>
      {fixNow.length > 0 && option !== "approve" && <GoesBack target={target} findings={fixNow} />}
      <RadioGroup value={option ?? ""} onValueChange={(value) => setOption(value as ReviewOption)} aria-label="Review result" className="gap-1.5">
        {choices.map((choice) => (
          <FieldLabel
            key={choice.value}
            htmlFor={`review-${choice.value}`}
            className="has-data-checked:border-input has-data-checked:bg-muted *:data-[slot=field]:px-3 *:data-[slot=field]:py-2.5 dark:has-data-checked:border-input dark:has-data-checked:bg-muted"
          >
            <Field orientation="horizontal" className="gap-2.5">
              <RadioGroupItem value={choice.value} id={`review-${choice.value}`} />
              <FieldContent>
                <FieldTitle className="text-[13px]">{choice.title}</FieldTitle>
                <FieldDescription className="text-xs">{choice.describe(target, findings !== undefined)}</FieldDescription>
              </FieldContent>
            </Field>
          </FieldLabel>
        ))}
      </RadioGroup>
      {unsent > 0 && <NotSent count={unsent} />}
      {error && <FieldError>{error}</FieldError>}
      <Button type="button" disabled={!option || pending} onClick={send}>
        {unsent > 0 ? "Approve anyway" : "Send review"}
      </Button>
    </div>
  );
}
