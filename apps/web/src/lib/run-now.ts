import type { StatusTone } from "./status";

export type NowInput = {
  status: string;
  executions: { nodeKey: string; attempt: number; status: string; error?: string | undefined }[];
  /** Node labels from the graph, by node key. */
  labels: Record<string, string>;
  prNumber: number | null;
  /** Open questions waiting for a person. */
  questions: number;
};

/** One line saying what a run is doing now, or how it ended, with the tone to show it in. */
export function describeNow({ status, executions, labels, prNumber, questions }: NowInput): { tone: StatusTone; text: string } {
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
  const running = latest("running");
  if (running) return { tone: "active", text: `${label(running.nodeKey)} is working${running.attempt > 1 ? `, attempt ${running.attempt}` : ""}` };
  const waiting = latest("waiting");
  if (waiting && questions > 0) return { tone: "attention", text: `Waiting for your answer to ${label(waiting.nodeKey)}` };
  if (waiting && prNumber !== null) return { tone: "attention", text: `Waiting for CI and reviews on PR #${prNumber}` };
  if (waiting) return { tone: "attention", text: `Waiting: ${label(waiting.nodeKey)}` };
  const pending = latest("pending");
  if (pending) return { tone: "neutral", text: `Queued: ${label(pending.nodeKey)}` };
  return { tone: "neutral", text: status };
}
