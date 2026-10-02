"use client";

import { useActionState } from "react";
import { RepeatIcon } from "lucide-react";
import { runAgainAction, type ActionState } from "@/app/projects/actions";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Starts the same task again on the latest version of the run's graph, then opens the new run. It asks
 * where to start: from the run's branch, first when the run committed work, or from scratch.
 */
export function RunAgainButton({ runId, branch, hasWork }: { runId: string; branch: string; hasWork: boolean }) {
  const [state, action, pending] = useActionState(runAgainAction, {} as ActionState);
  const fromBranch = { from: "branch", label: "Continue from the branch", detail: <>Starts at <span className="font-mono">{branch}</span>. The planner gets the earlier plan, decisions and open findings.</> };
  const fromScratch = { from: "scratch", label: "Start from scratch", detail: <>A new branch from the default branch, with only the task.</> };
  const choices = hasWork ? [fromBranch, fromScratch] : [fromScratch, fromBranch];
  return (
    <div className="flex items-center gap-2">
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" disabled={pending}>
            <RepeatIcon data-icon="inline-start" />
            Run again
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 gap-1 p-1.5" role="dialog" aria-label="Where the run starts">
          {choices.map((choice) => (
            <form key={choice.from} action={action}>
              <input type="hidden" name="runId" value={runId} />
              <input type="hidden" name="from" value={choice.from} />
              <button
                type="submit"
                disabled={pending}
                className="flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
              >
                <span className="font-medium">{choice.label}</span>
                <span className="text-xs text-muted-foreground">{choice.detail}</span>
              </button>
            </form>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}
