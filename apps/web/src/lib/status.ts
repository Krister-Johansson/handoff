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
  success: "border-transparent bg-success-bg text-success",
  active: "border-transparent bg-active-bg text-active",
  attention: "border-transparent bg-attention-bg text-attention",
  neutral: "border-border text-muted-foreground",
  danger: "border-transparent bg-danger-bg text-danger",
  muted: "border-transparent bg-secondary text-muted-foreground",
  repaired: "border-transparent bg-repaired-bg text-repaired",
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

/** The text colour of each tone, for a run's "what it does now" line. */
export const TONE_TEXT: Record<StatusTone, string> = {
  success: "text-success",
  active: "text-active",
  attention: "text-attention",
  danger: "text-danger",
  repaired: "text-repaired",
  neutral: "text-muted-foreground",
  muted: "text-muted-foreground",
};
