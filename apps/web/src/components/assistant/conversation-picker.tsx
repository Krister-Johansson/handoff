"use client";

import { useState } from "react";
import { HistoryIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatAgo } from "@/lib/format";
import { useAssistantPanel } from "./assistant-provider";

/** Earlier conversations, the most recent first, and a new one. */
export function ConversationPicker() {
  const panel = useAssistantPanel();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) void panel.loadConversations();
        }}
      >
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Conversations" title="Conversations">
            <HistoryIcon />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-1">
          {panel.conversations?.length ? (
            <ul aria-label="Conversations" className="flex max-h-80 flex-col overflow-y-auto">
              {panel.conversations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-muted"
                    onClick={() => {
                      setOpen(false);
                      void panel.openConversation(c.id);
                    }}
                  >
                    <span className="w-full truncate">{c.title}</span>
                    <span className="text-[11px] text-muted-foreground">{formatAgo(new Date(c.updatedAt))}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-1.5 text-[13px] text-muted-foreground">{panel.conversations ? "No conversations yet." : "Loading…"}</p>
          )}
        </PopoverContent>
      </Popover>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="New conversation" title="New conversation" onClick={panel.newConversation}>
        <PlusIcon />
      </Button>
    </div>
  );
}
