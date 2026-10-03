"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MicIcon, MicOffIcon, PanelRightOpenIcon, PowerIcon, SettingsIcon, ShieldCheckIcon, ShieldQuestionIcon, SquareIcon, Volume2Icon, XIcon } from "lucide-react";
import { ApprovalCard } from "@/components/assistant/approval-card";
import { useOptionalAssistant, useOptionalAssistantPanel } from "@/components/assistant/assistant-provider";
import { Button } from "@/components/ui/button";
import type { ChatMessage, PendingRequest } from "@/lib/assistant/port";
import { confirmQuestion } from "@/lib/voice/confirm-question";
import { cn } from "@/lib/utils";
import { useVoice, type Bubble } from "./voice-provider";
import { VoiceWave } from "./voice-wave";

type Reply = Extract<ChatMessage, { role: "assistant" }>;

const REPLY =
  "prose prose-sm max-w-none text-[13px] leading-[1.55] text-foreground dark:prose-invert prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5 prose-code:rounded prose-code:border prose-code:bg-muted prose-code:px-1 prose-code:text-[11.5px] prose-code:font-normal prose-code:before:content-none prose-code:after:content-none";

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid h-[17px] min-w-[17px] place-items-center rounded border border-b-2 bg-background px-1 font-mono text-[10px] text-muted-foreground">{children}</kbd>
  );
}

/**
 * The bubble's outline at the bottom centre of the page column, with the progress line along its top
 * edge while the assistant works. The shell's overlay slot keeps it at the bottom of the window.
 */
function Frame({ progress = false, children }: { progress?: boolean; children: ReactNode }) {
  return (
    <section
      aria-label="Voice assistant"
      className="absolute bottom-0 left-1/2 flex w-[min(480px,calc(100%-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-[14px] border bg-popover text-[13px] text-popover-foreground shadow-[0_2px_4px_oklch(0_0_0/6%),0_18px_48px_oklch(0_0_0/16%)] dark:shadow-[0_2px_4px_oklch(0_0_0/30%),0_18px_48px_oklch(0_0_0/45%)]"
    >
      {progress && (
        <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 overflow-hidden">
          <b className="absolute top-0 h-full w-[30%] animate-voice-progress rounded-sm bg-active-dot motion-reduce:left-0 motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-50" />
        </span>
      )}
      {children}
    </section>
  );
}

/** The round state icon at the start of the header. */
function StateIcon({ tone, children }: { tone: "live" | "ask" | "bad" | "plain"; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-[30px] flex-none place-items-center rounded-full [&_svg]:size-[15px]",
        tone === "live" && "bg-active-bg text-active",
        tone === "ask" && "bg-attention-bg text-attention",
        tone === "bad" && "bg-danger-bg text-danger",
        tone === "plain" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function Header({ icon, actions, children }: { icon: ReactNode; actions: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center gap-3 py-2.5 pr-2 pl-3.5">
      {icon}
      <div className="flex min-w-0 flex-1 flex-col gap-px">{children}</div>
      <div className="flex flex-none items-center gap-0.5">{actions}</div>
    </div>
  );
}

function Footer({ tone = "plain", children }: { tone?: "plain" | "ask"; children: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        "flex min-h-[38px] items-center gap-2 border-t py-1.5 pr-2 pl-3.5 text-xs text-muted-foreground [&_svg]:size-[13px]",
        tone === "ask" ? "border-t-attention-dot/35 bg-attention-bg text-foreground/80 [&_svg]:text-attention" : "bg-subtle",
      )}
    >
      {children}
    </div>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" className="size-[30px] [&_svg]:size-[15px]" aria-label="Close" title="Close (Esc)" onClick={onClick}>
      <XIcon />
    </Button>
  );
}

function EscCloses() {
  return (
    <span className="ml-auto flex flex-none items-center gap-1.5">
      <Kbd>Esc</Kbd>closes
    </span>
  );
}

function BlockedBubble({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <Frame>
      <Header
        icon={
          <StateIcon tone="bad">
            <MicOffIcon />
          </StateIcon>
        }
        actions={<CloseButton onClick={onClose} />}
      >
        <span role="alert" className="text-[13px] leading-[1.45] font-medium">
          {message}
        </span>
      </Header>
    </Frame>
  );
}

function OffBubble({ notice, switchedOff, onClose }: { notice: string; switchedOff: boolean; onClose: () => void }) {
  return (
    <Frame>
      <Header
        icon={
          <StateIcon tone="plain">
            <PowerIcon />
          </StateIcon>
        }
        actions={
          <>
            <Button size="xs" variant="outline" asChild>
              <Link href="/settings?tab=assistant" onClick={onClose}>
                <SettingsIcon data-icon="inline-start" />
                Settings
              </Link>
            </Button>
            <CloseButton onClick={onClose} />
          </>
        }
      >
        <div role="status" className="flex flex-col gap-px">
          <span className="truncate text-sm font-medium">{notice}</span>
          <span className="text-[12.5px] text-muted-foreground">
            {switchedOff ? "It is switched off in Settings." : "It needs CLAUDE_CODE_OAUTH_TOKEN in the dashboard's environment."}
          </span>
        </div>
      </Header>
    </Frame>
  );
}

/**
 * The confirmation cards, the reply's and those of calls an MCP Apps view made (with how a spoken
 * answer went), and once the turn is done the reply's text. No tool rows: the footer says Thinking
 * while the assistant works.
 */
function ReplyBody({ reply, cards, bubble }: { reply: Reply | undefined; cards: PendingRequest[]; bubble: Bubble }) {
  const text = !reply || reply.status === "streaming" ? "" : reply.text;
  if (!cards.length && !text && reply?.status !== "error") return null;
  const byVoice = (request: PendingRequest) => (bubble.answered?.requestId === request.requestId && request.status !== "open" ? bubble.answered.said : undefined);
  return (
    <div className="flex max-h-[280px] flex-col gap-2.5 overflow-auto border-t px-3.5 pt-3 pb-3.5 [&>*]:shrink-0">
      {cards.map((request) => (
        <div key={request.requestId} className="flex flex-col gap-1.5">
          <ApprovalCard request={request} question={confirmQuestion(request)} />
          {byVoice(request) && (
            <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground [&_svg]:size-3">
              <ShieldCheckIcon aria-hidden />
              {`${request.status === "approved" ? "Confirmed" : "Cancelled"} by voice: "${byVoice(request)}"`}
            </p>
          )}
        </div>
      ))}
      {text && (
        <div className={REPLY}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
      )}
      {reply?.status === "error" && <p className="text-xs text-danger">{reply.error ?? "The reply failed."}</p>}
    </div>
  );
}

const NO_CARDS: PendingRequest[] = [];

type StatusKind = "approval" | "listening" | "answering" | "speaking" | "working" | "done";

/**
 * What the footer is about: a card to answer, listening for a question or for the answer to the
 * reply's question, speaking, the assistant working, or done.
 */
function statusKind(reply: Reply | undefined, cards: PendingRequest[], bubble: Bubble, listening: boolean, speaking: boolean): StatusKind {
  if (cards.some((r) => r.status === "open")) return "approval";
  if (listening && bubble.answering) return "answering";
  if (listening && !bubble.question) return "listening";
  if (speaking) return "speaking";
  return reply?.status === "streaming" ? "working" : "done";
}

function ApprovalStatus({ bubble, listening }: { bubble: Bubble; listening: boolean }) {
  return (
    <Footer tone="ask">
      {listening ? <VoiceWave /> : <ShieldQuestionIcon aria-hidden />}
      <b className="font-medium text-foreground">{bubble.misheard ? "Say yes or no, or use the buttons." : "Say yes or no"}</b>
      <span className="ml-auto flex-none">{bubble.misheard ? `Heard "${bubble.misheard}"` : 'Words after "no" become the note'}</span>
    </Footer>
  );
}

function SpeakingStatus({ onStop }: { onStop: () => void }) {
  return (
    <Footer>
      <VoiceWave />
      <b className="font-medium text-foreground">Speaking</b>
      <span className="ml-auto flex-none">
        <Button type="button" size="xs" variant="outline" onClick={onStop}>
          <SquareIcon data-icon="inline-start" />
          Stop
        </Button>
      </span>
    </Footer>
  );
}

function WorkingStatus() {
  return (
    <Footer>
      <span aria-hidden className="size-1.5 rounded-full bg-active-dot" />
      Thinking
      <EscCloses />
    </Footer>
  );
}

function AnsweringStatus({ heard }: { heard: string }) {
  return (
    <Footer tone="ask">
      <VoiceWave />
      <b className="font-medium text-foreground">Listening for your answer</b>
      {heard && <span className="ml-auto min-w-0 truncate">{heard}</span>}
    </Footer>
  );
}

function KeyStatus({ keys, ask }: { keys: ReactNode; ask: boolean }) {
  return (
    <Footer>
      <span className="flex items-center gap-1">{keys}</span>
      {ask && <EscCloses />}
    </Footer>
  );
}

/** The footer: how to answer an approval, how to stop listening or speaking, or what the assistant is doing. */
function Status({ kind, bubble, listening }: { kind: StatusKind; bubble: Bubble; listening: boolean }) {
  const voice = useVoice();
  const footers: Record<StatusKind, () => ReactNode> = {
    approval: () => <ApprovalStatus bubble={bubble} listening={listening} />,
    listening: () => (
      <KeyStatus
        ask={false}
        keys={
          <>
            Press <Kbd>Ctrl</Kbd>
            <Kbd>M</Kbd> or <Kbd>Escape</Kbd> to stop
          </>
        }
      />
    ),
    speaking: () => <SpeakingStatus onStop={voice.stopSpeaking} />,
    answering: () => <AnsweringStatus heard={voice.interim} />,
    working: () => <WorkingStatus />,
    done: () => (
      <KeyStatus
        ask
        keys={
          <>
            Press <Kbd>Ctrl</Kbd>
            <Kbd>M</Kbd> to ask again
          </>
        }
      />
    ),
  };
  return footers[kind]();
}

/** The header's state icon: a shield for an approval, a waveform while listening, a speaker while speaking. */
function headerIcon(kind: StatusKind) {
  if (kind === "approval") {
    return (
      <StateIcon tone="ask">
        <ShieldQuestionIcon />
      </StateIcon>
    );
  }
  if (kind === "listening" || kind === "answering") {
    return (
      <StateIcon tone="live">
        <VoiceWave />
      </StateIcon>
    );
  }
  return <StateIcon tone={kind === "speaking" ? "live" : "plain"}>{kind === "speaking" ? <Volume2Icon /> : <MicIcon />}</StateIcon>;
}

function QuestionBubble({ bubble, reply, viewCards }: { bubble: Bubble; reply: Reply | undefined; viewCards: PendingRequest[] }) {
  const voice = useVoice();
  const assistant = useOptionalAssistant();
  const listening = voice.mode === "command" && (voice.state === "listening" || voice.state === "starting");
  const cards = [...(reply?.requests ?? []), ...viewCards];
  const kind = statusKind(reply, cards, bubble, listening, voice.speech.speaking && voice.speech.priority === "reply");
  const actions = (
    <>
      {bubble.question && assistant?.available && (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          aria-label="Open in panel"
          onClick={() => {
            voice.closeBubble();
            assistant.open();
          }}
        >
          <PanelRightOpenIcon data-icon="inline-start" />
          <span className="max-sm:hidden">Open in panel</span>
        </Button>
      )}
      <CloseButton onClick={voice.closeBubble} />
    </>
  );
  return (
    <Frame progress={kind === "working"}>
      <Header icon={headerIcon(kind)} actions={actions}>
        <span className="text-[11px] font-medium text-muted-foreground">{bubble.question ? "You asked" : "Listening"}</span>
        {bubble.question ? (
          <span className="truncate text-sm font-medium">{bubble.question}</span>
        ) : (
          <span className="truncate text-sm text-foreground/80 after:ml-0.5 after:inline-block after:h-[15px] after:w-px after:bg-foreground/60 after:align-[-2px]">
            {voice.interim}
          </span>
        )}
      </Header>
      <ReplyBody reply={reply} cards={cards} bubble={bubble} />
      <Status kind={kind} bubble={bubble} listening={listening} />
    </Frame>
  );
}

/**
 * The voice bubble at the bottom centre: what was heard or asked, Thinking while the assistant works,
 * then its reply (spoken as well), and a confirmation card that a spoken yes or no answers. It shows
 * no tool calls. The panel stays closed; Open in panel shows the whole conversation. Escape stops
 * speech, then closes it.
 */
export function VoiceBubble() {
  const voice = useVoice();
  const panel = useOptionalAssistantPanel();
  const { bubble } = voice;
  if (!bubble.open) return null;
  if (voice.state === "blocked" && voice.error) return <BlockedBubble message={voice.error} onClose={voice.closeBubble} />;
  if (bubble.notice) return <OffBubble notice={bubble.notice} switchedOff={panel?.offReason === "off"} onClose={voice.closeBubble} />;
  const reply = bubble.since === undefined ? undefined : panel?.messages.slice(bubble.since).find((m): m is Reply => m.role === "assistant");
  return <QuestionBubble bubble={bubble} reply={reply} viewCards={panel?.viewRequests ?? NO_CARDS} />;
}
