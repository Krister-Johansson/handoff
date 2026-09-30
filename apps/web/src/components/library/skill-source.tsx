"use client";

import { useActionState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { importSkillAction, type ImportState } from "@/app/library/skills-sh-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const RESULT = { unchanged: "Already up to date with skills.sh.", updated: "Updated from skills.sh.", imported: "Imported." };

/** Where an imported skill came from, with a check against skills.sh for a newer version. */
export function SkillSource({ id }: { id: string }) {
  const [state, action, pending] = useActionState(importSkillAction, {} as ImportState);
  return (
    <Alert>
      <AlertTitle>
        Imported from{" "}
        <a href={`https://skills.sh/${id}`} className="font-mono underline-offset-4 hover:underline">
          skills.sh/{id}
        </a>
      </AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>An update from skills.sh replaces edits made here.</span>
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="$stay" value="1" />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            <RefreshCwIcon data-icon="inline-start" />
            {pending ? "Checking" : "Check for update"}
          </Button>
        </form>
        {state.result && <span>{RESULT[state.result.status]}</span>}
        {state.error && <span className="text-destructive">{state.error}</span>}
      </AlertDescription>
    </Alert>
  );
}
