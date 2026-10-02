/** A finished run's times: wall time runs from its first claim to its end, nights included. */
export type ForecastRun = { startedAt: Date; finishedAt: Date; mergeQueuedAt: Date | null; mergeRequestedAt: Date | null };
/** A question a Human gate asked; unanswered, it stays open until the run ends. */
export type ForecastQuestion = { createdAt: Date; answeredAt: Date | null };
/** A permission request; undecided, it stays open until the run ends. */
export type ForecastPermission = { createdAt: Date; decidedAt: Date | null };

/** One run's time split into its parts, in milliseconds. */
export type RunParts = { wallMs: number; waitingMs: number };

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

/** One run's wall time and the part of it spent waiting on a person. */
export function runParts(run: ForecastRun, questions: ForecastQuestion[], permissions: ForecastPermission[], _executions: unknown[]): RunParts {
  const start = run.startedAt.getTime();
  const end = run.finishedAt.getTime();
  const open: Interval[] = [
    ...questions.map((q): Interval => [q.createdAt.getTime(), (q.answeredAt ?? run.finishedAt).getTime()]),
    ...permissions.map((p): Interval => [p.createdAt.getTime(), (p.decidedAt ?? run.finishedAt).getTime()]),
  ];
  return { wallMs: end - start, waitingMs: unionLength(open, start, end) };
}
