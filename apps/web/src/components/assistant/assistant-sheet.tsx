"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { BotIcon, Loader2Icon, ShieldQuestionIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { ChatMessage } from "@/lib/assistant/port";
import { ApprovalCard } from "./approval-card";
import { useAssistant, useAssistantPanel } from "./assistant-provider";
import { Composer } from "./composer";
import { ConversationPicker } from "./conversation-picker";
import { MessageList } from "./message-list";

type Status = { tone: "working" | "calling" | "waiting" | "plain"; text: string } | undefined;

/** One line on what the assistant is doing now; announced, unlike the streaming text. */
function statusLine(messages: ChatMessage[], streaming: boolean, agentActivity: string | undefined): Status {
  const last = messages.at(-1);
  if (last?.role === "assistant" && streaming) {
    if (last.requests.some((r) => r.status === "open")) return { tone: "waiting", text: "Waiting for your approval" };
    const running = last.calls.findLast((c) => c.status === "running");
    return running ? { tone: "calling", text: `Calling ${running.title}` } : { tone: "working", text: "Thinking" };
  }
  if (agentActivity) return { tone: "working", text: agentActivity };
  return last?.role === "assistant" && last.status === "stopped" ? { tone: "plain", text: "Stopped" } : undefined;
}

const STATUS_ICON: Record<NonNullable<Status>["tone"], ReactNode> = {
  working: <span aria-hidden className="size-1.5 rounded-full bg-active-dot" />,
  calling: <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" />,
  waiting: <ShieldQuestionIcon aria-hidden />,
  plain: null,
};

/** The height of the top bar (and the transcript strip in it), so the sheet starts below it. */
function useHeaderHeight() {
  const [height, setHeight] = useState(53);
  useEffect(() => {
    const header = document.querySelector("[data-slot=top-bar]");
    if (!header) return;
    const observer = new ResizeObserver(([entry]) => setHeight(Math.round(entry!.target.getBoundingClientRect().height)));
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return height;
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid h-[18px] min-w-[18px] place-items-center rounded border border-b-2 bg-background px-1 font-mono text-[10.5px] text-muted-foreground">
      {children}
    </kbd>
  );
}

function Empty() {
  return (
    <div className="flex flex-col gap-3 px-1 pt-2">
      <p className="max-w-[360px] text-[13px] leading-[1.55] text-foreground/85">
        Ask what needs you, how a run is going, or tell it to start, merge or answer something. It asks before it changes anything.
      </p>
      <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Kbd>⌘</Kbd>
          <Kbd>J</Kbd>opens and closes this panel
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Ctrl</Kbd>
          <Kbd>M</Kbd>dictates into the message box, <Kbd>Esc</Kbd>stops
        </span>
      </div>
    </div>
  );
}

function Off({ reason, onNavigate }: { reason: "no-token" | "off"; onNavigate: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2.5 px-5 py-6 text-[13px] leading-[1.55]">
      <p className="text-sm font-semibold">The assistant is off.</p>
      {reason === "off" ? (
        <p className="max-w-[380px] text-foreground/85">
          It is switched off in{" "}
          <Link href="/settings?tab=assistant" className="underline underline-offset-[3px]" onClick={onNavigate}>
            Settings
          </Link>
          .
        </p>
      ) : (
        <p className="max-w-[380px] text-foreground/85">
          It runs Claude Code on your subscription. Add CLAUDE_CODE_OAUTH_TOKEN to the dashboard&apos;s environment and restart it.
        </p>
      )}
    </div>
  );
}

/** From this width the panel docks beside the page; below it the panel overlays the page as a sheet. */
const DOCK_QUERY = "(min-width: 1280px)";

function subscribeDock(onChange: () => void) {
  const list = window.matchMedia(DOCK_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/** Whether the window is wide enough to dock the panel. The server renders the sheet, which starts closed. */
function useDocked() {
  return useSyncExternalStore(
    subscribeDock,
    () => window.matchMedia(DOCK_QUERY).matches,
    () => false,
  );
}

const DESCRIPTION = "Ask about your projects and runs, or have the assistant act on them. Changes wait for your approval.";

/**
 * The assistant panel, on the right below the top bar so the Assistant button, the microphone and the
 * transcript strip stay in view. From 1280 px it docks as a column beside the page, which narrows to
 * make room; below that it is a sheet over the page. Either way it stays open while the page changes
 * and is not modal, so the person can keep using the page.
 */
export function AssistantSheet() {
  const assistant = useAssistant();
  const top = useHeaderHeight();
  const docked = useDocked();
  if (docked) {
    if (!assistant.isOpen) return null;
    return (
      <aside
        aria-labelledby="assistant-title"
        aria-describedby="assistant-description"
        className="sticky flex w-[448px] flex-none flex-col self-start border-l bg-card"
        style={{ top, height: `calc(100dvh - ${top}px)` }}
        // Escape closes the panel only when nothing is written in the composer.
        onKeyDown={(e) => {
          if (e.key === "Escape" && !e.defaultPrevented && !assistant.composerRef.current?.value) assistant.close();
        }}
      >
        <div className="flex h-12 flex-none items-center gap-0.5 border-b pr-2 pl-4">
          <h2 id="assistant-title" className="mr-auto text-sm font-semibold">
            Assistant
          </h2>
          <p id="assistant-description" className="sr-only">
            {DESCRIPTION}
          </p>
          {assistant.available && <ConversationPicker />}
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close" title="Close" onClick={assistant.close}>
            <XIcon />
          </Button>
        </div>
        <PanelBody />
      </aside>
    );
  }
  return (
    <Sheet open={assistant.isOpen} onOpenChange={(open) => (open ? assistant.open() : assistant.close())} modal={false}>
      <SheetContent
        side="right"
        className="w-full gap-0 bg-card shadow-[-16px_0_40px_oklch(0_0_0/7%)] sm:max-w-md dark:shadow-[-16px_0_40px_oklch(0_0_0/22%)]"
        style={{ top, height: `calc(100dvh - ${top}px)` }}
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Escape closes the panel only when nothing is written in the composer.
        onEscapeKeyDown={(e) => {
          if (assistant.composerRef.current?.value) e.preventDefault();
        }}
      >
        <SheetHeader className="h-12 flex-none flex-row items-center gap-0.5 border-b py-0 pr-12 pl-4">
          <SheetTitle className="mr-auto text-sm font-semibold">Assistant</SheetTitle>
          <SheetDescription className="sr-only">{DESCRIPTION}</SheetDescription>
          {assistant.available && <ConversationPicker />}
        </SheetHeader>
        <PanelBody />
      </SheetContent>
    </Sheet>
  );
}

/** The panel under its header: the conversation, the status line and the composer, or why the assistant is off. */
function PanelBody() {
  const assistant = useAssistant();
  const panel = useAssistantPanel();
  const status = statusLine(panel.messages, assistant.status === "streaming", panel.agentActivity);
  if (!assistant.available) return <Off reason={panel.offReason} onNavigate={assistant.close} />;
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {panel.agentRequests.length > 0 && (
          <section aria-labelledby="agent-requests" className="flex flex-col gap-2 border-b pb-4">
            <h3 id="agent-requests" className="flex items-center gap-1.5 text-xs font-medium text-foreground/85 [&_svg]:size-3.5 [&_svg]:text-muted-foreground">
              <BotIcon aria-hidden />A browser agent asks
              <span className="ml-auto font-normal text-muted-foreground">through WebMCP</span>
            </h3>
            {panel.agentRequests.map((request) => (
              <ApprovalCard key={request.requestId} request={request} />
            ))}
          </section>
        )}
        {panel.messages.length ? <MessageList messages={panel.messages} /> : <Empty />}
      </div>
      <div className="flex flex-none flex-col gap-2 border-t bg-card px-4 pt-2 pb-3.5">
        <p
          aria-live="polite"
          className={`flex min-h-[18px] items-center gap-[7px] text-xs [&_svg]:size-[13px] ${status?.tone === "waiting" ? "text-attention" : "text-muted-foreground"}`}
        >
          {status && STATUS_ICON[status.tone]}
          {status?.text}
        </p>
        <Composer />
      </div>
    </>
  );
}
