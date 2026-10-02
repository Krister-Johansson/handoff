import type { NotificationTone } from "@handoff/core";

export type { NotificationTone };

/** What the feed page can narrow to: the unread items, or one tone. */
export type NotificationFilter = "unread" | NotificationTone;

/** One entry of the notification feed: what a sender told a person, as the sender wrote it. */
export type NotificationItem = {
  id: string;
  /** How it looks and sounds: plain news, something that went well, something that waits for a person, or something that went wrong. */
  tone: NotificationTone;
  title: string;
  body: string;
  /** The dashboard page it leads to, when it leads anywhere. */
  href: string | null;
  createdAt: Date;
  /** Whether it came after the person last opened the feed. */
  unread: boolean;
};

/** A notification as the API sends it, with its time as an ISO string. */
export type NotificationJson = Omit<NotificationItem, "createdAt"> & { createdAt: string };
