/** list_inbox's answer, which the Needs you list draws and the permission and question cards read their details from. */
import type { ViewHost } from "./app";
import type { PermissionData, QuestionData } from "./cards";

type Ref = { project: string; run: string; url: string };
export type Inbox = {
  permissions: (Ref & { id: string; node: string; tool: string; asks: string; detail: string })[];
  reviews: (Ref & { id: string; node: string; question: string })[];
  questions: (Ref & { id: string; node: string; question: string; options: string[] })[];
  ready_to_merge: (Ref & { run_id: string; pr: number | null })[];
  failed_runs: (Ref & { run_id: string; node: string })[];
  stuck_runs: (Ref & { run_id: string; node: string; loop: string; attempts: number })[];
  /** `unresolved_threads` is set when the merge waits on review threads nobody resolved, rather than on an approving review. */
  pull_requests: (Ref & { run_id: string; pr: number; pr_url: string | null; ci: string | null; unresolved_threads?: number })[];
};

export const isInbox = (value: unknown): value is Inbox => typeof value === "object" && value !== null && Array.isArray((value as Inbox).permissions) && Array.isArray((value as Inbox).questions);

/** A permission request of list_inbox as the permission card takes it. */
export const permissionOf = (p: Inbox["permissions"][number]): PermissionData => ({ id: p.id, node: p.node, asks: p.asks, detail: p.detail, project: p.project, run: p.run, url: p.url });

/** A question of list_inbox as the question card takes it: a Try it gate's address is its page. */
export const questionOf = (q: Inbox["questions"][number]): QuestionData => ({
  id: q.id,
  node: q.node,
  question: q.question,
  options: q.options,
  project: q.project,
  run: q.run,
  url: q.url,
  ...(/\/try\/[^/]+$/.test(q.url) ? { try_url: q.url } : {}),
});

/** A review of list_inbox as the question card takes it: it opens on its page. */
export const reviewOf = (q: Inbox["reviews"][number]): QuestionData => ({ id: q.id, node: q.node, question: q.question, options: [], project: q.project, run: q.run, review_url: q.url });

/** Reads the Inbox (list_inbox, a read) when the host proxies tool calls; undefined otherwise or when it fails. */
export async function readInbox(host: ViewHost): Promise<Inbox | undefined> {
  if (!host.call) return undefined;
  const inbox = await host.call("list_inbox", {});
  return inbox.ok && isInbox(inbox.value) ? inbox.value : undefined;
}
