/** What a notification is about: a run that started, finished or failed, a gate that needs a person, or a pull request ready to merge. */
export type NotificationKind = "started" | "finished" | "failed" | "input" | "ready";

/** What the feed page can narrow to: the unread items, or one kind. */
export type NotificationFilter = "unread" | NotificationKind;

/** One entry of the notification feed. */
export type NotificationItem = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string;
  createdAt: Date;
  /** Whether it came after the person last opened the feed. */
  unread: boolean;
};

/** A notification as the API sends it, with its time as an ISO string. */
export type NotificationJson = Omit<NotificationItem, "createdAt"> & { createdAt: string };
