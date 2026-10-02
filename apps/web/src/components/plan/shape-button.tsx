"use client";

import { MessageSquareIcon } from "lucide-react";
import { useOptionalAssistant } from "@/components/assistant/assistant-provider";
import { Button } from "@/components/ui/button";

/**
 * Writes into the composer the way typing does: the composer keeps its text in React state, so the
 * value goes through the element's own setter and an input event, which React reads as a change.
 */
function prefill(composer: HTMLTextAreaElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(composer, text);
  composer.dispatchEvent(new Event("input", { bubbles: true }));
  composer.focus();
  composer.setSelectionRange(text.length, text.length);
}

/** Opens the assistant panel with "Shape work in <project>: " in the composer, ready for the rest. */
export function ShapeButton({ projectName, label = "Shape with the assistant", variant = "outline" }: { projectName: string; label?: string; variant?: "outline" | "default" }) {
  const assistant = useOptionalAssistant();
  return (
    <Button
      variant={variant}
      disabled={!assistant?.available}
      title={assistant?.available ? undefined : "The assistant is off. Turn it on in Settings, or shape from Claude Code."}
      onClick={() => {
        if (!assistant) return;
        assistant.open();
        // The panel mounts the composer as it opens, so the text goes in on the next tick.
        setTimeout(() => {
          if (assistant.composerRef.current) prefill(assistant.composerRef.current, `Shape work in ${projectName}: `);
        }, 0);
      }}
    >
      <MessageSquareIcon data-icon="inline-start" />
      {label}
    </Button>
  );
}
