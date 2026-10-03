"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { BotIcon, Loader2Icon, MinusIcon, ShieldQuestionIcon, SquarePenIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatMessage } from "@/lib/assistant/port";
import { cn } from "@/lib/utils";
import { ApprovalCard } from "./approval-card";
import { AssistButton } from "./assist-button";
import { useAssistant, useAssistantPanel } from "./assistant-provider";
import { NO_PROJECT, ProjectTile } from "./chat-bits";
import { Composer } from "./composer";
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

/** The height of the top bar (and the transcript strip in it), so the panel starts below it. */
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

/** Where the panel opens: docked beside the page from 1280 px, on a phone below 768 px full width under the top bar, else floating. */
export type PanelMode = "dock" | "float" | "phone";
const DOCK_QUERY = "(min-width: 1280px)";
const PHONE_QUERY = "(max-width: 767px)";

function subscribeMode(onChange: () => void) {
  const lists = [window.matchMedia(DOCK_QUERY), window.matchMedia(PHONE_QUERY)];
  for (const list of lists) list.addEventListener("change", onChange);
  return () => {
    for (const list of lists) list.removeEventListener("change", onChange);
  };
}

const modeNow = (): PanelMode => (window.matchMedia(DOCK_QUERY).matches ? "dock" : window.matchMedia(PHONE_QUERY).matches ? "phone" : "float");

/** The panel's place for the window's width. The server renders it closed, so its guess does not show. */
export function usePanelMode(): PanelMode {
  return useSyncExternalStore(subscribeMode, modeNow, () => "float");
}

const DESCRIPTION = "Ask about your projects and runs, or have the assistant act on them. Changes wait for your approval.";

/**
 * The assistant: the assist button in the bottom right corner and the panel it opens. From 1280 px the
 * panel docks as a column beside the page, which narrows to make room, and the button hides while it
 * is open. Below that it floats above the button, which turns into Hide; on a phone it fills the width
 * under the top bar. The panel stays open while the page changes and is not modal.
 */
export function AssistantPanel() {
  const assistant = useAssistant();
  const panel = useAssistantPanel();
  const mode = usePanelMode();
  const top = useHeaderHeight();
  const button = useRef<HTMLButtonElement>(null);
  const open = assistant.isOpen;
  // Closing from inside the panel hands focus back to the assist button, which shows again.
  const close = () => {
    assistant.close();
    setTimeout(() => button.current?.focus(), 0);
  };
  // Escape closes the panel only when nothing is written in the composer.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !e.defaultPrevented && !assistant.composerRef.current?.value) close();
  };
  const waiting =
    panel.agentRequests.length > 0 ||
    (panel.chats?.conversations.some((c) => c.state === "approval") ?? false) ||
    panel.messages.some((m) => m.role === "assistant" && m.requests.some((r) => r.status === "open"));
  const header = <PanelHeader floating={mode === "float"} onClose={close} />;
  return (
    <>
      {open && mode === "dock" && (
        <aside
          aria-label="Assistant"
          aria-describedby="assistant-description"
          data-variant="dock"
          className="sticky flex w-[448px] flex-none flex-col self-start border-l bg-card"
          style={{ top, height: `calc(100dvh - ${top}px)` }}
          onKeyDown={onKeyDown}
        >
          {header}
          <PanelBody />
        </aside>
      )}
      {open && mode !== "dock" && (
        // A non-modal dialog: the page behind it stays usable.
        <dialog
          open
          aria-label="Assistant"
          aria-describedby="assistant-description"
          data-variant={mode}
          className={cn(
            // The browser places an open dialog centred in the window; these put it in the corner or under the top bar.
            "fixed z-40 m-0 flex max-h-none max-w-none flex-col overflow-hidden bg-card p-0 text-card-foreground",
            mode === "float"
              ? "top-auto right-6 bottom-[84px] left-auto h-[620px] w-[400px] rounded-[14px] border shadow-[0_2px_4px_oklch(0_0_0/6%),0_18px_48px_oklch(0_0_0/16%)] dark:shadow-[0_2px_4px_oklch(0_0_0/30%),0_18px_48px_oklch(0_0_0/45%)]"
              : "inset-x-0 bottom-0 h-auto w-full border-0",
          )}
          style={mode === "float" ? { maxHeight: `calc(100dvh - ${top + 100}px)` } : { top }}
          onKeyDown={onKeyDown}
        >
          {header}
          <PanelBody />
        </dialog>
      )}
      {(!open || mode === "float") && (
        <AssistButton ref={button} expanded={open} waiting={waiting} available={assistant.available} onClick={() => (open ? close() : assistant.open())} />
      )}
    </>
  );
}

/** The open chat's title and project, a new chat, and Close (Hide while the panel floats). */
function PanelHeader({ floating, onClose }: { floating: boolean; onClose: () => void }) {
  const assistant = useAssistant();
  const panel = useAssistantPanel();
  const chat = panel.conversation;
  return (
    <div className="flex h-14 flex-none items-center gap-0.5 border-b pr-2 pl-4">
      <div className="mr-1.5 flex min-w-0 flex-1 flex-col leading-tight">
        <h2 id="assistant-title" className="truncate text-[13.5px] font-semibold">
          {chat?.title ?? "New chat"}
        </h2>
        {chat && (
          <span className="flex min-w-0 items-center gap-[5px] text-[11.5px] text-muted-foreground">
            <ProjectTile project={chat.project} className="size-[13px] rounded-[3px] text-[8px]" />
            <span className="truncate">{chat.project?.name ?? NO_PROJECT}</span>
          </span>
        )}
      </div>
      <p id="assistant-description" className="sr-only">
        {DESCRIPTION}
      </p>
      {assistant.available && (
        <Button type="button" variant="ghost" size="icon-sm" aria-label="New chat" title="New chat" onClick={panel.newConversation}>
          <SquarePenIcon />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={floating ? "Hide the assistant" : "Close"}
        title={floating ? "Hide (Esc)" : "Close (Esc)"}
        onClick={onClose}
      >
        {floating ? <MinusIcon /> : <XIcon />}
      </Button>
    </div>
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
