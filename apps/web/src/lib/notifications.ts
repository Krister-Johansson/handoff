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
  /** Whether the person has done what it asked: answered, asked for the merge, repaired the run. */
  done: boolean;
  /** Whether it came after the person last opened the feed and is not done. */
  unread: boolean;
};

/** A notification as the API sends it, with its time as an ISO string. */
export type NotificationJson = Omit<NotificationItem, "createdAt"> & { createdAt: string };
