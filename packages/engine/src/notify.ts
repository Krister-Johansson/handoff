import { notifies, toneOf, type NotifyKind, type NotifySettings } from "@handoff/core";
import { createNotification, type DbExecutor } from "@handoff/db";

/** What a sender writes for its notification: the text shown as it is, and the dashboard page it leads to. */
export type Told = { title: string; body: string; href: string };

/**
 * Sends a node's notification about `kind`, when the node's settings have that kind on. The sender
 * writes the title, the body and the link; the kind only picks the tone. Given a transaction, the
 * notification commits with what it is about.
 */
export async function notifyFrom(
  db: DbExecutor,
  node: { notify?: NotifySettings | undefined; config?: Record<string, unknown> },
  kind: NotifyKind,
  run: { id: string; projectId: string },
  told: Told,
): Promise<void> {
  if (!notifies(node, kind)) return;
  await createNotification(db, { tone: toneOf(kind), projectId: run.projectId, runId: run.id, ...told });
}
