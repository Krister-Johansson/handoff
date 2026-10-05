"use client";

import { FolderCodeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { editorLabel, editorUrl, useCodeEditor } from "@/lib/code-editor";
import type { WorktreeState } from "@/lib/worktree-state";

const PATH = "font-mono text-[10.5px] break-all opacity-85";
const NOTE = "opacity-85";

/** The tooltip's lines: what the button does, or why it cannot. */
function Reason({ worktree }: { worktree: WorktreeState }) {
  switch (worktree.state) {
    case "open":
      return (
        <>
          <span className="font-medium">Opens the run&apos;s worktree</span>
          <span className={PATH}>{worktree.shown}</span>
          {worktree.running && <span className={NOTE}>A step is working in this folder. What you change here goes into the run.</span>}
        </>
      );
    case "not-created":
      return <span>The run makes its worktree when its first step starts.</span>;
    case "released":
      return (
        <>
          <span>The worktree was removed when the run finished.</span>
          {worktree.prNumber !== null && <span className={NOTE}>Its changes are in PR #{worktree.prNumber}.</span>}
        </>
      );
    case "removed-by-gc":
      return <span>handoff gc removed the worktree. Repair the run to make it again.</span>;
    case "missing":
      return (
        <>
          <span>The worktree is not on this machine:</span>
          <span className={PATH}>{worktree.shown}</span>
        </>
      );
  }
}

/**
 * Open in VS Code: a link to the run's worktree in the editor this browser picked, which the operating
 * system hands to the editor. The server gives a path only for the run's own worktree on disk; without
 * one the button stays, disabled, and its tooltip says why.
 */
export function OpenInEditor({ worktree, align = "center" }: { worktree: WorktreeState; align?: "center" | "end" }) {
  const editor = useCodeEditor();
  const label = `Open in ${editorLabel(editor)}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {worktree.state === "open" ? (
          <Button size="sm" variant="outline" asChild>
            <a href={editorUrl(editor, worktree.path)}>
              <FolderCodeIcon data-icon="inline-start" />
              {label}
            </a>
          </Button>
        ) : (
          <Button type="button" size="sm" variant="outline" aria-disabled="true" className="cursor-default opacity-50">
            <FolderCodeIcon data-icon="inline-start" />
            {label}
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom" align={align} className="max-w-[420px] flex-col items-start gap-0.5 leading-snug">
        <Reason worktree={worktree} />
      </TooltipContent>
    </Tooltip>
  );
}
