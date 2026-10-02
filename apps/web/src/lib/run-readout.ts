type Execution = { nodeKey: string; attempt: number; status: string; error?: { code: string; message: string } | null };

const STATUS: Record<string, string> = {
  queued: "is queued",
  running: "is running",
  waiting: "is waiting",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "was cancelled",
};

/** A run as the Read aloud button says it: task, status, each step's latest state, and the latest failure. */
export function runReadout(run: { task: string; status: string; executions: Execution[] }): string {
  const latest = new Map<string, Execution>();
  for (const e of run.executions) {
    const seen = latest.get(e.nodeKey);
    if (!seen || e.attempt >= seen.attempt) latest.set(e.nodeKey, e);
  }
  const failure = run.executions.findLast((e) => e.status === "failed" && e.error);
  const parts = [
    `${run.task.trim().replace(/[.!?]?$/, ".")}`,
    `The run ${STATUS[run.status] ?? run.status}.`,
    ...(latest.size ? [`Steps: ${[...latest.values()].map((e) => `${e.nodeKey} ${e.status}`).join(", ")}.`] : []),
    ...(failure ? [`The latest failure: ${failure.nodeKey} attempt ${failure.attempt}, ${failure.error!.message.trim().replace(/[.!?]?$/, ".")}`] : []),
  ];
  return parts.join(" ");
}
