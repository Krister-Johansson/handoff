"use client";

import { MessageSquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAssistant } from "./assistant-provider";

/** The header's button for the assistant panel; Mod+J does the same. */
export function AssistantButton() {
  const assistant = useAssistant();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground data-[open=true]:bg-muted data-[open=true]:text-foreground"
      aria-label="Assistant"
      title={assistant.available ? "Assistant (⌘J)" : "Assistant (off)"}
      data-open={assistant.isOpen}
      onClick={() => (assistant.isOpen ? assistant.close() : assistant.open())}
    >
      <MessageSquareIcon />
    </Button>
  );
}
