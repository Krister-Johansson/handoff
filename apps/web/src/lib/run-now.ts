import { whoseReview, type ReReviewWait } from "./reviewers";
import type { StatusTone } from "./status";

export type NowInput = {
  status: string;
  executions: { nodeKey: string; attempt: number; status: string; error?: string | undefined }[];
  /** Node labels from the graph, by node key. */
  labels: Record<string, string>;
  prNumber: number | null;
  /** Open questions waiting for a person. */
  questions: number;
  /** How many of them are reviews, answered on the review page. */
  reviews: number;
  /** Where the run stands in its project's merge queue, while its merge step waits there. */
  queue?: RunQueue | undefined;
  /** Open issues GitHub says block the run's issues, while the run waits for them at its start. */
  blockedBy?: number[] | undefined;
  /** Tool calls the run's steps wait for a person to allow, oldest first, each with what it asks to do. */
  permissions?: { nodeKey: string; action: string }[] | undefined;
  /** How many review threads the merge step waits on a person to resolve, while it waits on them. */
  unresolvedThreads?: number | undefined;
  /** Whose next review the PR step waits for after handoff answered review comments, while it does. */
  reReview?: ReReviewWait | undefined;
};

const andList = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

export type RunQueue = { position: number; requested: boolean; mode: "manual" | "auto" };

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

/** What a run waiting in the merge queue is waiting for. */
function queueText({ position, requested, mode }: RunQueue): string {
  if (position === 1) return requested || mode === "auto" ? "Merging next" : "Ready to merge";
  return `${requested ? "Merge requested" : "Ready to merge"}, ${ordinal(position)} in line`;
}

/** One line saying what a run is doing now, or how it ended, with the tone to show it in. */
export function describeNow({ status, executions, labels, prNumber, questions, reviews, queue, blockedBy, permissions, unresolvedThreads, reReview }: NowInput): { tone: StatusTone; text: string } {
  const label = (key: string) => labels[key] ?? key;
  const latest = (s: string) => executions.findLast((e) => e.status === s);
  if (status === "cancelled") return { tone: "muted", text: "Cancelled." };
  if (status === "succeeded") {
    const merged = prNumber !== null && executions.some((e) => e.nodeKey === "merge" && e.status === "passed");
    return { tone: "success", text: merged ? `Done. PR #${prNumber} merged.` : "Done." };
  }
  if (status === "failed") {
    const failed = latest("failed");
    return { tone: "danger", text: failed ? `Stopped at ${label(failed.nodeKey)}${failed.error ? `: ${failed.error}` : ""}` : "Failed." };
  }
  // A step waiting on a permission request still runs, but it is blocked until someone answers.
  const asking = permissions?.[0];
  if (asking) return { tone: "attention", text: `${label(asking.nodeKey)} ${asking.action}` };
  const running = latest("running");
  if (running) return { tone: "active", text: `${label(running.nodeKey)} is working${running.attempt > 1 ? `, attempt ${running.attempt}` : ""}` };
  const waiting = latest("waiting");
  if (waiting && blockedBy?.length) return { tone: "attention", text: `Waiting for ${andList(blockedBy.map((n) => `#${n}`))} to close` };
  if (waiting && unresolvedThreads) {
    const one = unresolvedThreads === 1;
    return { tone: "attention", text: `PR #${prNumber} has ${unresolvedThreads} unresolved review ${one ? "thread" : "threads"}; the merge goes on once ${one ? "it is" : "they are"} resolved` };
  }
  if (waiting && queue) return { tone: "attention", text: queueText(queue) };
  // handoff answered review comments and waits for the reviewer: nobody has to act yet, so it reads as work in progress.
  if (waiting && reReview?.reviewers.length && questions === 0) {
    return { tone: "active", text: `Waiting for ${whoseReview(reReview.reviewers)}, ${reReview.items} ${reReview.items === 1 ? "comment" : "comments"} answered` };
  }
  if (waiting && reviews > 0) return { tone: "attention", text: `${label(waiting.nodeKey)} waits for your review` };
  if (waiting && questions > 0) return { tone: "attention", text: `Waiting for your answer to ${label(waiting.nodeKey)}` };
  if (waiting && prNumber !== null) return { tone: "attention", text: `Waiting for CI and reviews on PR #${prNumber}` };
  if (waiting) return { tone: "attention", text: `Waiting: ${label(waiting.nodeKey)}` };
  const pending = latest("pending");
  if (pending) return { tone: "neutral", text: `Queued: ${label(pending.nodeKey)}` };
  return { tone: "neutral", text: status };
}
