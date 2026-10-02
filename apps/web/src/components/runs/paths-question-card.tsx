"use client";

import { useActionState } from "react";
import Link from "next/link";
import { FileWarningIcon } from "lucide-react";
import { answerAction, type InboxActionState } from "@/app/inbox/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { runPath } from "@/lib/paths";

export type PathsQuestionItem = {
  id: string;
  runId: string;
  projectId: string;
  task: string;
  projectName: string;
  nodeKey: string;
  question: string;
  context?: Record<string, unknown>;
};

const ANSWERS = [
  { option: "allow", label: "Allow for this run", variant: "default" },
  { option: "send_back", label: "Send back", variant: "outline" },
  { option: "fail", label: "Fail the step", variant: "ghost" },
] as const;

/**
 * A step changed files outside its plan and nothing else failed, so it waits for a person: allow the
 * files for the rest of the run, send the work back with them, or fail the step.
 */
export function PathsQuestionCard({ item, compact = false }: { item: PathsQuestionItem; compact?: boolean }) {
  const [state, action, pending] = useActionState(answerAction, {} as InboxActionState);
  const files = Array.isArray(item.context?.files) ? item.context.files.map(String) : [];
  return (
    <Card className="gap-3 border-attention-dot/35 py-4">
      <CardContent className="flex flex-col gap-3 px-5">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="inline-grid size-7 place-items-center rounded-[7px] bg-attention-bg text-attention [&_svg]:size-3.5">
            <FileWarningIcon />
          </span>
          <h3 className="text-[15px] font-semibold">{item.nodeKey} changed files outside the plan</h3>
        </div>
        {!compact && (
          <p className="text-xs text-muted-foreground">
            {item.projectName} ·{" "}
            <Link href={runPath(item.projectId, item.runId)} className="hover:text-foreground hover:underline">
              {item.task}
            </Link>
          </p>
        )}
        <ul className="flex flex-col gap-1 font-mono text-[13px]">
          {files.map((file) => (
            <li key={file} className="break-all">
              {file}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          Every other check passed. Allowing the files lets this step and its later attempts change them for the rest of the run. Sending back asks the step to undo them.
        </p>
        <form
          action={action}
          className="flex flex-col gap-3"
          toolname={`answer_paths_${item.id}`}
          tooldescription={`Answers ${item.question}: allow the files for this run, send the work back, or fail the step. The person presses the button.`}
        >
          <input type="hidden" name="questionId" value={item.id} />
          <input type="hidden" name="runId" value={item.runId} />
          <Field data-invalid={state.error ? true : undefined}>
            <FieldLabel htmlFor={`paths-note-${item.id}`}>Note (optional)</FieldLabel>
            <Textarea
              id={`paths-note-${item.id}`}
              name="answer"
              rows={2}
              placeholder="Why the files belong to the change, or what to do instead"
              toolparamdescription="Why the files belong to the change, or what the step should do instead"
            />
            {state.error && <FieldError>{state.error}</FieldError>}
          </Field>
          <div className="flex flex-wrap gap-2">
            {ANSWERS.map((a) => (
              <Button key={a.option} type="submit" name="option" value={a.option} variant={a.variant} disabled={pending}>
                {a.label}
              </Button>
            ))}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
