"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronRightIcon, ShieldCheckIcon, ShieldQuestionIcon, ShieldXIcon, TimerIcon } from "lucide-react";
import { Tag } from "@/components/tag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PendingRequest } from "@/lib/assistant/port";
import { cn } from "@/lib/utils";
import { useAssistant } from "./assistant-provider";

/** "4:52 left" until the card counts as denied, ticking each second. */
function TimeLeft({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000));
  return (
    <span className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-muted-foreground tabular-nums [&_svg]:size-3" title="Counts as denied when the time is up">
      <TimerIcon aria-hidden />
      {`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} left`}
    </span>
  );
}

/** A summary as the rest of a sentence: "Cancel run 7f3a" becomes "cancel run 7f3a", "PR #5" stays. */
const lowerFirst = (text: string) => (/^[A-Z][a-z]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text);

const ICON = { open: ShieldQuestionIcon, approved: ShieldCheckIcon, denied: ShieldXIcon };
const ICON_TONE = { open: "text-attention", approved: "text-success", denied: "text-muted-foreground" };

const ANSWERED = { approval: { approved: "Approved", denied: "Denied" }, confirm: { approved: "Confirmed", denied: "Cancelled" } } as const;

function CardHead({ request, question }: { request: PendingRequest; question: string | undefined }) {
  const Icon = ICON[request.status];
  return (
    <div className="flex min-h-5 items-center gap-[7px]">
      <Icon aria-hidden className={cn("size-[15px]", ICON_TONE[request.status])} />
      <span className="font-semibold">{question ?? request.title}</span>
      {request.status !== "open" && (
        <Tag tone={request.status === "approved" ? "success" : "outline"} className="ml-auto">
          {ANSWERED[question ? "confirm" : "approval"][request.status]}
        </Tag>
      )}
      {request.status === "open" && request.expiresAt && <TimeLeft expiresAt={request.expiresAt} />}
    </div>
  );
}

/** The arguments as sent, folded behind their names. */
function Arguments({ args }: { args: unknown }) {
  const keys = args && typeof args === "object" ? Object.keys(args).join(", ") : "";
  return (
    <details className="group/args text-xs text-muted-foreground">
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon aria-hidden className="size-3 transition-transform group-open/args:rotate-90" />
        Arguments
        {keys && <span className="truncate font-mono text-[11px] text-muted-foreground/70 group-open/args:hidden">{keys}</span>}
      </summary>
      <pre className="mt-1.5 overflow-auto rounded-md border bg-subtle px-2.5 py-1.5 font-mono text-[11px] leading-[1.55] text-foreground/85">{JSON.stringify(args, null, 2)}</pre>
    </details>
  );
}

/** Confirm and Cancel, with no note: a spoken "no" carries the note instead. */
function ConfirmAnswer({ onAnswer }: { onAnswer: (approve: boolean, note: string) => void }) {
  return (
    <div className="mt-0.5 flex gap-2">
      <Button type="button" size="sm" onClick={() => onAnswer(true, "")}>
        <CheckIcon data-icon="inline-start" />
        Confirm
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={() => onAnswer(false, "")}>
        Cancel
      </Button>
    </div>
  );
}

/** The note and the Approve and Deny buttons; Enter in the note never approves. */
function Answer({ requestId, onAnswer }: { requestId: string; onAnswer: (approve: boolean, note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`approval-note-${requestId}`} className="text-xs font-medium">
          Note (optional)
        </Label>
        <Input id={`approval-note-${requestId}`} className="bg-background" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why not, or what to do instead" />
      </div>
      <div className="mt-0.5 flex gap-2">
        <Button type="button" size="sm" onClick={() => onAnswer(true, note)}>
          <CheckIcon data-icon="inline-start" />
          Approve
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onAnswer(false, note)}>
          Deny
        </Button>
      </div>
    </>
  );
}

/**
 * A state-changing call waiting for the person: what it will do, its arguments as sent, the time left,
 * and Approve or Deny with a note. It takes focus when it appears. Approving needs a click (or Space on
 * the button). Once answered it turns neutral with the answer. With `question` (the voice bubble) it
 * is a confirmation card: titled with the question, answered with Confirm or Cancel and no note.
 */
export function ApprovalCard({ request, question }: { request: PendingRequest; question?: string }) {
  const assistant = useAssistant();
  const [sent, setSent] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (request.status === "open") card.current?.focus();
  }, [request.status]);
  const answer = (approve: boolean, note: string) => {
    setSent(true);
    void assistant.respond(request.requestId, { approve, ...(!approve && note.trim() ? { note: note.trim() } : {}) });
  };
  return (
    <div
      ref={card}
      role="group"
      aria-label={question ?? `Approve: ${request.title}`}
      tabIndex={-1}
      className={cn(
        "flex flex-col gap-2 rounded-md border px-3 pt-2.5 pb-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        request.status === "open" ? "border-attention-dot/45 bg-attention-bg" : "border-border bg-card",
      )}
    >
      <CardHead request={request} question={question} />
      <p>{question ? `${request.title}: ${lowerFirst(request.summary)}` : request.summary}</p>
      <Arguments args={request.args} />
      {request.note && (
        <p className="flex gap-1.5 text-[12.5px] text-foreground/85">
          <span className="flex-none font-medium text-muted-foreground">Note</span>
          {request.note}
        </p>
      )}
      {request.status === "open" && !sent && (question ? <ConfirmAnswer onAnswer={answer} /> : <Answer requestId={request.requestId} onAnswer={answer} />)}
    </div>
  );
}
