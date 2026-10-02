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
        <PopoverContent align="end" className="w-72 p-0">
          <p className="px-3 pt-2.5 pb-1 text-xs font-medium text-muted-foreground">Conversations</p>
          {panel.conversations?.length ? (
            <ul aria-label="Conversations" className="flex max-h-80 flex-col gap-px overflow-y-auto p-1">
              {panel.conversations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-current={c.id === panel.conversationId ? "true" : undefined}
                    className="flex w-full items-baseline gap-3 rounded-sm px-[9px] py-[7px] text-left text-[13px] text-foreground/85 hover:bg-muted aria-[current=true]:bg-muted aria-[current=true]:font-medium aria-[current=true]:text-foreground"
                    onClick={() => {
                      setOpen(false);
                      void panel.openConversation(c.id);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    <span className="flex-none text-[11px] font-normal whitespace-nowrap text-muted-foreground">{formatAgo(new Date(c.updatedAt))}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 pt-1.5 pb-4 text-[13px] text-muted-foreground">{panel.conversations ? "No conversations yet." : "Loading…"}</p>
          )}
        </PopoverContent>
      </Popover>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="New conversation" title="New conversation" onClick={panel.newConversation}>
        <PlusIcon />
      </Button>
    </div>
  );
}
