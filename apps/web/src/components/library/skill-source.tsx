"use client";

import { useActionState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { importSkillAction, type ImportState } from "@/app/library/skills-sh-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const RESULT = { unchanged: "Already up to date with skills.sh.", updated: "Updated from skills.sh.", imported: "Imported." };

/** github.com/owner/repo, or the skill's folder in it for a skill below the repository root. */
function githubHref(id: string) {
  const [owner, repo, ...folder] = id.split("/");
  return folder.length ? `https://github.com/${owner}/${repo}/tree/HEAD/${folder.join("/")}` : `https://github.com/${owner}/${repo}`;
}

/**
 * Where an imported skill came from. A skills.sh skill can be checked for a newer version; a skill
 * from a GitHub repository is updated by importing the repository again.
 */
export function SkillSource({ source }: { source: { registry: "skills.sh" | "github"; id: string } }) {
  if (source.registry === "github") {
    return (
      <Alert>
        <AlertTitle>
          Imported from{" "}
          <a href={githubHref(source.id)} className="font-mono underline-offset-4 hover:underline">
            github.com/{source.id}
          </a>
        </AlertTitle>
        <AlertDescription>Importing the repository again updates this skill and replaces edits made here.</AlertDescription>
      </Alert>
    );
  }
  return <SkillsShSource id={source.id} />;
}

function SkillsShSource({ id }: { id: string }) {
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
