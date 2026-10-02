import type { RefObject } from "react";

/** A tool call in a reply, as the panel shows it. */
export type ToolCallView = { id: string; name: string; title: string; summary: string; status: "running" | "done" | "failed" | "denied"; result?: string };

/** A state-changing call waiting for, or answered by, the person. */
export type PendingRequest = {
  requestId: string;
  toolUseId?: string | undefined;
  name: string;
  title: string;
  summary: string;
  args: unknown;
  status: "open" | "approved" | "denied";
  note?: string;
  /** When an open card counts as denied. */
  expiresAt?: string;
};

export type ChatMessage =
  | { id: string; role: "user"; text: string; source?: "voice" | "typed" }
  | {
      id: string;
      role: "assistant";
      text: string;
      calls: ToolCallView[];
      requests: PendingRequest[];
      /** Where the assistant took the page during the reply, such as "Opened Inbox". */
      notes?: { id: string; text: string }[];
      status: "streaming" | "done" | "stopped" | "error";
      error?: string;
    };

/** A reply as it streams: per delta with done false, and once with the full text and done true. */
export type ReplyUpdate = { id: string; text: string; done: boolean };

/**
 * The assistant as the rest of the dashboard uses it: the panel's composer is one input adapter, the
 * voice plan's microphone is another. `respond` answers an approval card; the panel requires a click.
 */
export type AssistantPort = {
  available: boolean;
  status: "idle" | "streaming";
  send(text: string, opts?: { source?: "voice" | "typed" }): Promise<void>;
  stop(): Promise<void>;
  onReply(cb: (reply: ReplyUpdate) => void): () => void;
  onRequest(cb: (request: PendingRequest) => void): () => void;
  respond(requestId: string, decision: { approve: boolean; note?: string }): Promise<void>;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  open(): void;
  close(): void;
  isOpen: boolean;
};
