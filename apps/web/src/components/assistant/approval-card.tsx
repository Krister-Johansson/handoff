"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldQuestionIcon } from "lucide-react";
import { Tag } from "@/components/tag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PendingRequest } from "@/lib/assistant/port";
import { useAssistant } from "./assistant-provider";

/**
 * A state-changing call waiting for the person: what it will do, its arguments as sent, and Approve or
 * Deny with a note. It takes focus when it appears. Approving needs a click (or Space on the button);
 * Enter in the note never approves.
 */
export function ApprovalCard({ request }: { request: PendingRequest }) {
  const assistant = useAssistant();
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const open = request.status === "open" && !sent;
  useEffect(() => {
    if (request.status === "open") card.current?.focus();
  }, [request.status]);
  const answer = (approve: boolean) => {
    setSent(true);
    void assistant.respond(request.requestId, { approve, ...(!approve && note.trim() ? { note: note.trim() } : {}) });
  };
  return (
    <div
      ref={card}
      role="group"
      aria-label={`Approve: ${request.title}`}
      tabIndex={-1}
      className="flex flex-col gap-2 rounded-md border border-attention-dot/40 bg-attention-bg px-3 py-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-2">
        <ShieldQuestionIcon aria-hidden className="size-3.5 text-attention" />
        <span className="font-medium">{request.title}</span>
        {request.status !== "open" && <Tag tone={request.status === "approved" ? "success" : "outline"}>{request.status === "approved" ? "Approved" : "Denied"}</Tag>}
      </div>
      <p>{request.summary}</p>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Arguments</summary>
        <pre className="mt-1 overflow-auto rounded bg-background p-2 font-mono text-[11px]">{JSON.stringify(request.args, null, 2)}</pre>
      </details>
      {request.note && <p className="text-xs text-muted-foreground">{request.note}</p>}
      {open && (
        <>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`approval-note-${request.requestId}`} className="text-xs font-normal">
              Note (optional)
            </Label>
            <Input id={`approval-note-${request.requestId}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why not, or what to do instead" />
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => answer(true)}>
              Approve
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => answer(false)}>
              Deny
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
