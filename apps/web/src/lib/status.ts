export type StatusTone = "default" | "secondary" | "destructive" | "outline";

const tones: Record<string, StatusTone> = {
  succeeded: "default",
  passed: "default",
  repaired: "secondary",
  running: "secondary",
  waiting: "outline",
  pending: "outline",
  queued: "outline",
  failed: "destructive",
  cancelled: "destructive",
};

export const statusTone = (status: string): StatusTone => tones[status] ?? "outline";

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
