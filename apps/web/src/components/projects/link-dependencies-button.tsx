"use client";

import { useState, useTransition } from "react";
import { LinkIcon } from "lucide-react";
import { linkDependenciesAction } from "@/app/projects/actions";
import { Button } from "@/components/ui/button";

/**
 * Turns the "Depends on" lines in the repository's open issues into GitHub's own "blocked by" links.
 * It writes to the repository on GitHub, so it runs only when a person presses it.
 */
export function LinkDependenciesButton({ projectId }: { projectId: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const link = () =>
    start(async () => {
      const result = await linkDependenciesAction({ projectId });
      if (!result.ok) setMessage({ text: result.error ?? "Linking failed.", error: true });
      else setMessage({ text: result.linked ? `Linked ${result.linked} ${result.linked === 1 ? "dependency" : "dependencies"} on GitHub.` : "Every Depends on line is already linked." });
    });
  return (
    <span className="flex items-center gap-2">
      {message && <span className={message.error ? "text-xs text-danger" : "text-xs text-muted-foreground"}>{message.text}</span>}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={link}
        title="Adds a blocked-by link on GitHub for each open issue a Depends on line names"
      >
        <LinkIcon data-icon="inline-start" />
        Link Depends on lines on GitHub
      </Button>
    </span>
  );
}
