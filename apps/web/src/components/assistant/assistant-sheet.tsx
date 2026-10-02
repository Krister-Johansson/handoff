"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { ChatMessage } from "@/lib/assistant/port";
import { ApprovalCard } from "./approval-card";
import { useAssistant, useAssistantPanel } from "./assistant-provider";
import { Composer } from "./composer";
import { ConversationPicker } from "./conversation-picker";
import { MessageList } from "./message-list";

/** One line on what the assistant is doing now; announced, unlike the streaming text. */
function statusLine(messages: ChatMessage[], streaming: boolean): string | undefined {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return undefined;
  if (streaming) {
    if (last.requests.some((r) => r.status === "open")) return "Waiting for your approval";
    const running = last.calls.findLast((c) => c.status === "running");
    return running ? `Calling ${running.title}` : "Thinking";
  }
  return last.status === "stopped" ? "Stopped" : undefined;
}

/**
 * The assistant panel: a sheet on the right that stays open while the page behind it changes. It is
 * not modal, so the person can keep using the page.
 */
export function AssistantSheet() {
  const assistant = useAssistant();
  const panel = useAssistantPanel();
  const status = statusLine(panel.messages, assistant.status === "streaming") ?? panel.agentActivity;
  return (
    <Sheet open={assistant.isOpen} onOpenChange={(open) => (open ? assistant.open() : assistant.close())} modal={false}>
      <SheetContent
        side="right"
        className="w-full gap-0 sm:max-w-md"
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Escape closes the panel only when nothing is written in the composer.
        onEscapeKeyDown={(e) => {
          if (assistant.composerRef.current?.value) e.preventDefault();
        }}
      >
        <SheetHeader className="flex-row items-center justify-between gap-2 border-b pr-12">
          <SheetTitle>Assistant</SheetTitle>
          <SheetDescription className="sr-only">Ask about your projects and runs, or have the assistant act on them. Changes wait for your approval.</SheetDescription>
          {assistant.available && <ConversationPicker />}
        </SheetHeader>
        {assistant.available ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {panel.agentRequests.length > 0 && (
                <section aria-labelledby="agent-requests" className="mb-3 flex flex-col gap-2">
                  <h3 id="agent-requests" className="text-xs font-medium text-muted-foreground">
                    A browser agent asks
                  </h3>
                  {panel.agentRequests.map((request) => (
                    <ApprovalCard key={request.requestId} request={request} />
                  ))}
                </section>
              )}
              {panel.messages.length ? (
                <MessageList messages={panel.messages} />
              ) : (
                <p className="text-[13px] text-muted-foreground">Ask what needs you, how a run is going, or tell it to start, merge or answer something. It asks before it changes anything.</p>
              )}
            </div>
            <div className="flex flex-col gap-2 border-t px-4 py-3">
              <p aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
                {status}
              </p>
              <Composer />
            </div>
          </>
        ) : (
          <div className="px-4 py-3 text-[13px]">
            <p className="font-medium">The assistant is off.</p>
            <p className="mt-1 text-muted-foreground">It runs Claude Code on your subscription. Add CLAUDE_CODE_OAUTH_TOKEN to the dashboard&apos;s environment and restart it.</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
