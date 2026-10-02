import type { PlanSize } from "@handoff/github";

/**
 * A finished run's times: wall time runs from its first claim to its end, nights included. A pull request
 * in a manual merge queue waits on the person from when it joined the queue until they ask to merge it.
 */
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

/**
 * An execution's queue time inside the run: a start execution's wait before the run's first claim is not part
 * of it. An execution from before queued_ms has 0 there and gives its last pending stretch, claimed minus
 * runnable, which misses earlier stretches.
 */
function queueInRun(execution: ForecastExecution, start: number): number {
  if (execution.queuedMs > 0) return Math.max(0, execution.queuedMs - Math.max(0, start - execution.createdAt.getTime()));
  if (!execution.claimedAt) return 0;
  return Math.max(0, execution.claimedAt.getTime() - Math.max(execution.runnableAt.getTime(), start));
}

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
    // A pull request in a manual merge queue waits for the person to ask to merge; auto merging asks nobody.
    ...(run.mergeQueuedAt && run.mergeRequestedAt ? [[run.mergeQueuedAt.getTime(), run.mergeRequestedAt.getTime()] as Interval] : []),
  ];
  const wallMs = end - start;
  const waitingMs = unionLength(open, start, end);
  const queueMs = executions.reduce((sum, e) => sum + queueInRun(e, start), 0);
  return { wallMs, waitingMs, queueMs, agentMs: Math.max(0, wallMs - waitingMs - queueMs) };
}

/** A run that counts toward its size's forecast: its parts and its reported cost. */
export type ForecastSample = RunParts & { costUsd: number };

/** What a size usually takes, in minutes, from this project's succeeded runs of that size. */
export type Forecast = {
  size: PlanSize;
  source: "runs" | "default";
  /** The median wall time of the runs, or the size's default under five runs. */
  minutes: number;
  /** Agent, queue and waiting-on-you minutes, scaled to add up to `minutes`; null for a default. */
  parts: { agent: number; queue: number; waiting: number } | null;
  /** The median reported cost of a run, in US dollars; null for a default. */
  costUsd: number | null;
  runs: number;
  /** The median wall time measured over the runs, shown next to a default too; null without runs. */
  measuredMinutes: number | null;
};

/** A forecast needs this many runs; under it a size uses its default. */
export const FORECAST_MIN_RUNS = 5;
/** Minutes a size takes until it has enough runs of its own. */
export const DEFAULT_MINUTES: Record<PlanSize, number> = { S: 30, M: 60, L: 120 };

/** The median, the mean of the middle two for an even count. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * A size's forecast: usually the median wall time, split by each part's share of the parts summed over every
 * run, so agent, queue and waiting add up to the median shown.
 */
export function forecastOf(samples: ForecastSample[], size: PlanSize): Forecast {
  const measured = samples.length > 0 ? median(samples.map((s) => s.wallMs)) / 60_000 : null;
  if (measured === null || samples.length < FORECAST_MIN_RUNS) {
    return { size, source: "default", minutes: DEFAULT_MINUTES[size], parts: null, costUsd: null, runs: samples.length, measuredMinutes: measured };
  }
  const minutes = measured;
  const sum = (part: (s: ForecastSample) => number) => samples.reduce((total, s) => total + part(s), 0);
  const agent = sum((s) => s.agentMs);
  const queue = sum((s) => s.queueMs);
  const waiting = sum((s) => s.waitingMs);
  const whole = agent + queue + waiting;
  const share = (part: number) => (whole > 0 ? (minutes * part) / whole : 0);
  return {
    size,
    source: "runs",
    minutes,
    parts: { agent: share(agent), queue: share(queue), waiting: share(waiting) },
    costUsd: median(samples.map((s) => s.costUsd)),
    runs: samples.length,
    measuredMinutes: minutes,
  };
}

export type Forecasts = Record<PlanSize, Forecast>;

/** How long a task takes in hours, and where that comes from: a "proposal" is the planner's size, drawn dashed. */
export type Duration = { hours: number; source: "estimate" | "forecast" | "default" | "proposal" };

/**
 * A task's duration: its manual estimate, else the forecast of its Size, else the forecast of its planner's
 * proposal; undefined with none of them. A task with a Size ignores the proposal.
 */
export function durationOf(item: { size?: PlanSize | undefined; estimate?: number | undefined }, forecasts: Forecasts, proposal: PlanSize | undefined): Duration | undefined {
  if (item.estimate !== undefined) return { hours: item.estimate, source: "estimate" };
  if (item.size) {
    const forecast = forecasts[item.size];
    return { hours: forecast.minutes / 60, source: forecast.source === "runs" ? "forecast" : "default" };
  }
  if (proposal) return { hours: forecasts[proposal].minutes / 60, source: "proposal" };
  return undefined;
}
