"use client";

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertCircleIcon, ArrowUpRightIcon, MicIcon } from "lucide-react";
import type { ChatMessage } from "@/lib/assistant/port";
import { ApprovalCard } from "./approval-card";
import { ToolRows } from "./tool-rows";

export const REPLY_PROSE =
  "prose prose-sm max-w-none text-[13px] leading-[1.55] text-foreground dark:prose-invert prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5 prose-pre:my-1.5 prose-a:underline-offset-[3px] prose-code:rounded prose-code:border prose-code:bg-muted prose-code:px-1 prose-code:text-[11.5px] prose-code:font-normal prose-code:before:content-none prose-code:after:content-none";

/**
 * The conversation: the person's messages as bubbles (marked when said by voice), and each reply's
 * tool rows, approval cards, navigation notes and text at full width.
 */
export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const end = useRef<HTMLDivElement>(null);
  const last = messages.at(-1);
  const tail = last?.role === "assistant" ? `${last.text.length}:${last.calls.length}:${last.requests.length}:${last.notes?.length ?? 0}` : String(messages.length);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [tail]);
  return (
    <div className="flex flex-col gap-3.5">
      {messages.map((message) =>
        message.role === "user" ? (
          <div key={message.id} className="flex flex-col items-end gap-1">
            <p className="max-w-[86%] rounded-[12px_12px_4px_12px] border bg-muted px-[11px] py-[7px] text-[13px] leading-[1.45] whitespace-pre-wrap dark:border-transparent">
              {message.text}
            </p>
            {message.source === "voice" && (
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground/80 [&_svg]:size-[11px]">
                <MicIcon aria-hidden />
                Sent by voice
              </p>
            )}
          </div>
        ) : (
          <div key={message.id} className="flex flex-col gap-2">
            <ToolRows calls={message.calls} />
            {message.requests.map((request) => (
              <ApprovalCard key={request.requestId} request={request} />
            ))}
            {message.notes?.map((note) => (
              <p key={note.id} role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-[13px]">
                <ArrowUpRightIcon aria-hidden />
                {note.text}
              </p>
            ))}
            {message.text && (
              <div className={REPLY_PROSE}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
              </div>
            )}
            {message.status === "error" && (
              <p className="flex items-start gap-1.5 text-[12.5px] leading-[1.45] text-danger [&_svg]:mt-px [&_svg]:size-3.5">
                <AlertCircleIcon aria-hidden />
                {message.error ?? "The reply failed."}
              </p>
            )}
          </div>
        ),
      )}
      <div ref={end} />
    </div>
  );
}
