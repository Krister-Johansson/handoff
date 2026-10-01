"use client";

import { useActionState } from "react";
import { RepeatIcon } from "lucide-react";
import { runAgainAction, type ActionState } from "@/app/projects/actions";
import { Button } from "@/components/ui/button";

/** Starts the same task again on the latest version of the run's graph, then opens the new run. */
export function RunAgainButton({ runId }: { runId: string }) {
  const [state, action, pending] = useActionState(runAgainAction, {} as ActionState);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="runId" value={runId} />
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        <RepeatIcon data-icon="inline-start" />
        Run again
      </Button>
    </form>
  );
}
