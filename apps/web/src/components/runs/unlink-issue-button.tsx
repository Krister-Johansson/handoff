"use client";

import { useState, useTransition } from "react";
import { UnlinkIcon } from "lucide-react";
import { unlinkIssueAction } from "@/app/inbox/actions";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";

/**
 * Takes a linked issue off the run, asked first: its pull request no longer closes it, and a task the
 * run moved on the plan goes back to the Status it had. A refusal stays in the dialog.
 */
export function UnlinkIssueButton({ runId, issue }: { runId: string; issue: { number: number; title: string } }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const confirm = () =>
    startTransition(async () => {
      const result = await unlinkIssueAction({ runId, issue: issue.number });
      if (result.error) return setError(result.error);
      setOpen(false);
    });
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(undefined);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Unlink #${issue.number}`} title={`Unlink #${issue.number}`} className="-my-1 size-5 text-muted-foreground hover:text-foreground">
          <UnlinkIcon aria-hidden />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Unlink #{issue.number} {issue.title} from this run?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The pull request no longer closes it, and merging the run leaves it open. A task the run moved on the plan goes back to the Status it had before the run.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <FieldError>{error}</FieldError>}
        <AlertDialogFooter>
          <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={pending} onClick={confirm}>
            Unlink
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
