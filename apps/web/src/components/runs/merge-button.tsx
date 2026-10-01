"use client";

import { useState, useTransition } from "react";
import { GitMergeIcon } from "lucide-react";
import { requestMergeAction } from "@/app/projects/actions";
import { Button } from "@/components/ui/button";

/** Asks to merge the run's pull request, first in its project's merge queue. */
export function MergeButton({ projectId, runId }: { projectId: string; runId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <span className="ml-auto flex shrink-0 items-center gap-2">
      {error && <span className="text-xs text-danger">{error}</span>}
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await requestMergeAction({ runId, projectId });
            setError(result.ok ? undefined : result.error);
          })
        }
      >
        <GitMergeIcon data-icon="inline-start" />
        Merge
      </Button>
    </span>
  );
}
