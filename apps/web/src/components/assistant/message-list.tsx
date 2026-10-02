"use client";

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@/lib/assistant/port";
import { ApprovalCard } from "./approval-card";
import { ToolCard } from "./tool-card";

const PROSE = "prose prose-sm max-w-none text-[13px] text-foreground dark:prose-invert prose-p:my-1.5 prose-ul:my-1.5 prose-pre:my-1.5 prose-code:before:content-none prose-code:after:content-none";

/** The conversation: the person's messages, and each reply's text, tool calls and approval cards. */
export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const end = useRef<HTMLDivElement>(null);
  const last = messages.at(-1);
  const tail = last?.role === "assistant" ? `${last.text.length}:${last.calls.length}:${last.requests.length}:${last.notes?.length ?? 0}` : String(messages.length);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [tail]);
  return (
    <div className="flex flex-col gap-3">
      {messages.map((message) =>
        message.role === "user" ? (
          <p key={message.id} className="self-end rounded-lg bg-secondary px-3 py-2 text-[13px] whitespace-pre-wrap">
            {message.text}
          </p>
        ) : (
          <div key={message.id} className="flex flex-col gap-2">
            {message.calls.map((call) => (
              <ToolCard key={call.id} call={call} />
            ))}
            {message.requests.map((request) => (
              <ApprovalCard key={request.requestId} request={request} />
            ))}
            {message.notes?.map((note) => (
              <p key={note.id} role="status" className="text-xs text-muted-foreground">
                {note.text}
              </p>
            ))}
            {message.text && (
              <div className={PROSE}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
              </div>
            )}
            {message.status === "error" && <p className="text-xs text-danger">{message.error ?? "The reply failed."}</p>}
          </div>
        ),
      )}
      <div ref={end} />
    </div>
  );
}
