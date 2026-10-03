import { LayersIcon } from "lucide-react";
import type { ChatState, ConversationSummary } from "@/lib/assistant/transport";
import { cn } from "@/lib/utils";

/** What a chat outside any project is called where its project would be. */
export const NO_PROJECT = "All projects";

/** A chat's project as a letter tile, or a dashed tile with layers for a chat outside any project. */
export function ProjectTile({ project, className }: { project: ConversationSummary["project"]; className?: string }) {
  return (
    // The letter is drawn, not written, so the tile adds nothing to the text of the row it sits in.
    <span
      aria-hidden
      data-letter={project ? project.name.charAt(0).toLowerCase() : undefined}
      className={cn(
        "grid size-4 flex-none place-items-center rounded-[4px] text-[9.5px] leading-none font-semibold before:content-[attr(data-letter)] [&_svg]:size-2.5",
        project ? "bg-muted text-foreground/80" : "border border-dashed border-border text-muted-foreground",
        className,
      )}
    >
      {!project && <LayersIcon />}
    </span>
  );
}

const STATE_TEXT: Record<ChatState, string> = { approval: "Approve", answering: "Answering" };

/** Approve while an approval card waits, Answering while a reply streams. */
export function ChatStateChip({ state }: { state: ChatState }) {
  return (
    <span className={cn("inline-flex flex-none items-center gap-1 pr-1 text-[11px] font-medium", state === "approval" ? "text-attention" : "text-active")}>
      <span aria-hidden className={cn("size-1.5 rounded-full", state === "approval" ? "bg-attention-dot" : "bg-active-dot")} />
      {STATE_TEXT[state]}
    </span>
  );
}
