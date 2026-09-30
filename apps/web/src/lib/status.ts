export type StatusTone = "success" | "active" | "attention" | "neutral" | "danger" | "muted" | "repaired";

const tones: Record<string, StatusTone> = {
  succeeded: "success",
  passed: "success",
  running: "active",
  waiting: "attention",
  queued: "neutral",
  pending: "neutral",
  failed: "danger",
  cancelled: "muted",
  repaired: "repaired",
  sent_back: "attention",
};

export const statusTone = (status: string): StatusTone => tones[status] ?? "neutral";

/** Badge colors per tone, readable in light and dark mode. */
export const TONE_CLASS: Record<StatusTone, string> = {
  success: "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  active: "border-transparent bg-sky-500/15 text-sky-700 dark:text-sky-300",
  attention: "border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300",
  neutral: "border-border text-muted-foreground",
  danger: "border-transparent bg-destructive/15 text-destructive",
  muted: "border-transparent bg-muted text-muted-foreground",
  repaired: "border-transparent bg-violet-500/15 text-violet-700 dark:text-violet-300",
};

/** Status a node execution moves to when this event arrives, if any. */
export function statusFromEvent(type: string): string | undefined {
  return (
    {
      "node.created": "pending",
      "node.claimed": "running",
      "node.passed": "passed",
      "node.failed": "failed",
      "node.waiting": "waiting",
      "node.woken": "pending",
      "node.interrupted": "pending",
      "node.reclaimed": "pending",
      "node.retrying": "pending",
      "node.repaired": "repaired",
    } as Record<string, string>
  )[type];
}

export function runStatusFromEvent(type: string): string | undefined {
  return (
    { "run.started": "running", "run.succeeded": "succeeded", "run.failed": "failed", "run.cancelled": "cancelled", "node.waiting": undefined } as Record<
      string,
      string | undefined
    >
  )[type];
}
