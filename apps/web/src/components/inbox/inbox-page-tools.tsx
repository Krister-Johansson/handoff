"use client";

import { describePermission } from "@handoff/core";
import { usePageTools } from "@/lib/assistant/use-page-tools";
import type { InboxView } from "./inbox-view";

/**
 * What the Inbox shows, by group, as where_am_i gives it: each card's id (what page_show_item takes,
 * and the question, permission, run or execution id the catalog's tools take), its run and what it asks.
 */
function describeInbox(view: InboxView, project: { id: string; name: string } | null) {
  const run = (item: { runId: string; projectName: string; task: string }) => ({ runId: item.runId, project: item.projectName, task: item.task });
  return {
    project,
    permissions: (view.permissions ?? []).map((p) => {
      const { action, detail } = describePermission(p.toolName, p.input);
      return { id: p.id, ...run(p), nodeKey: p.nodeKey, tool: p.toolName, action, detail };
    }),
    reviews: view.reviews.map((q) => ({ id: q.id, ...run(q), question: q.question })),
    questions: view.questions.map((q) => ({ id: q.id, ...run(q), nodeKey: q.nodeKey, reason: q.reason, question: q.question, options: q.options })),
    readyToMerge: view.readyToMerge.map((r) => ({ id: r.runId, ...run(r), prNumber: r.prNumber })),
    failedRuns: view.failedRuns.map((f) => ({
      id: f.executionId,
      ...run(f),
      nodeKey: f.nodeKey,
      attempt: f.attempt,
      error: f.error ? `${f.error.code}: ${f.error.message.split("\n")[0]}` : null,
    })),
    stuckRuns: view.stuckRuns.map((s) => ({ id: s.runId, ...run(s), nodeKey: s.nodeKey, loop: s.loop, attempts: s.attempts })),
    pullRequests: view.pullRequests.map((p) => ({ id: p.executionId, ...run(p), number: p.number, url: p.url })),
  };
}

/**
 * The Inbox's tools for the assistant while it is open. It acts on nothing: answering, deciding,
 * repairing, cancelling and merging go through the catalog's tools with the ids where_am_i gives.
 * `view` is what the page shows, narrowed to `project` when it is.
 */
export function InboxPageTools({ view, project }: { view: InboxView; project: { id: string; name: string } | null }) {
  usePageTools(
    "inbox",
    {
      page_show_item: ({ id }) => {
        const shown = describeInbox(view, project);
        const group = GROUPS.find((g) => shown[g.key].some((item) => item.id === id));
        const item = group && shown[group.key].find((i) => i.id === id);
        const card = item && document.getElementById(id);
        if (!group || !item || !card) throw new Error(`No card in the Inbox has the id ${id}. where_am_i lists the cards' ids.`);
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.focus({ preventScroll: true });
        return `Showing the ${group.name} of ${item.task} (${item.project}).`;
      },
    },
    () => describeInbox(view, project),
  );
  return null;
}

/** The Inbox's groups as where_am_i keys them, and what one of their cards is called. */
const GROUPS = [
  { key: "permissions", name: "permission request" },
  { key: "reviews", name: "review" },
  { key: "questions", name: "question" },
  { key: "readyToMerge", name: "pull request ready to merge" },
  { key: "failedRuns", name: "failed step" },
  { key: "stuckRuns", name: "run out of rounds" },
  { key: "pullRequests", name: "pull request to review" },
] as const;
