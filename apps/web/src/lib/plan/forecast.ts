/** A finished run's times: wall time runs from its first claim to its end, nights included. */
export type ForecastRun = { startedAt: Date; finishedAt: Date; mergeQueuedAt: Date | null; mergeRequestedAt: Date | null };
/** A question a Human gate asked; unanswered, it stays open until the run ends. */
export type ForecastQuestion = { createdAt: Date; answeredAt: Date | null };
/** A permission request; undecided, it stays open until the run ends. */
export type ForecastPermission = { createdAt: Date; decidedAt: Date | null };

/**
 * One step execution of a run: `queuedMs` sums the time it was ready and not running over its claims, and
 * includes the wait for a worker before the run's first claim, which lies outside the run's wall time.
 */
export type ForecastExecution = { createdAt: Date; runnableAt: Date; claimedAt: Date | null; queuedMs: number; costUsd: number | null };

/** One run's time split into its parts, in milliseconds: agent, queue and waiting on you make up the wall time. */
export type RunParts = { wallMs: number; waitingMs: number; queueMs: number; agentMs: number };

type Interval = [number, number];

/** The length of the union of intervals, each clipped to [from, to]. */
function unionLength(intervals: Interval[], from: number, to: number): number {
  const clipped = intervals
    .map(([a, b]): Interval => [Math.max(a, from), Math.min(b, to)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let end = -Infinity;
  for (const [a, b] of clipped) {
    if (b <= end) continue;
    total += b - Math.max(a, end);
    end = b;
  }
  return total;
}

/** An execution's queue time inside the run: a start execution's wait before the run's first claim is not part of it. */
const queueInRun = (execution: ForecastExecution, start: number) => Math.max(0, execution.queuedMs - Math.max(0, start - execution.createdAt.getTime()));

/**
 * One run's wall time split into waiting on a person, queue and agent time. Agent time is what is left, so it
 * includes CI and pull request waits; it is never below zero.
 */
export function runParts(run: ForecastRun, questions: ForecastQuestion[], permissions: ForecastPermission[], executions: ForecastExecution[]): RunParts {
  const start = run.startedAt.getTime();
  const end = run.finishedAt.getTime();
  const open: Interval[] = [
    ...questions.map((q): Interval => [q.createdAt.getTime(), (q.answeredAt ?? run.finishedAt).getTime()]),
    ...permissions.map((p): Interval => [p.createdAt.getTime(), (p.decidedAt ?? run.finishedAt).getTime()]),
  ];
  const wallMs = end - start;
  const waitingMs = unionLength(open, start, end);
  const queueMs = executions.reduce((sum, e) => sum + queueInRun(e, start), 0);
  return { wallMs, waitingMs, queueMs, agentMs: Math.max(0, wallMs - waitingMs - queueMs) };
}
