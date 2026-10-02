import { expect, test } from "vitest";
import { forecastOf, runParts } from "./forecast";

/** An instant `minutes` after 09:00 on 1 October 2026. */
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 9, minutes));
const MIN = 60_000;

/** A run from 09:00 for `minutes`, with no merge queue. */
const run = (minutes: number) => ({ startedAt: at(0), finishedAt: at(minutes), mergeQueuedAt: null, mergeRequestedAt: null });

test("waiting on you is the union of open questions and permission requests inside the run", () => {
  const parts = runParts(
    run(60),
    // 09:10 to 09:20, and 09:15 to 09:30 overlapping it, and one asked before the run started that reaches into it until 09:05.
    [
      { createdAt: at(10), answeredAt: at(20) },
      { createdAt: at(15), answeredAt: at(30) },
      { createdAt: at(-10), answeredAt: at(5) },
    ],
    // 09:25 to 09:35 overlaps the second question; 09:55, never decided, is open until the run ends.
    [
      { createdAt: at(25), decidedAt: at(35) },
      { createdAt: at(55), decidedAt: null },
    ],
    [],
  );
  // 09:00 to 09:05, 09:10 to 09:35 and 09:55 to 10:00.
  expect(parts.waitingMs).toBe(35 * MIN);
  expect(parts.wallMs).toBe(60 * MIN);
});

test("time in a manual merge queue counts as waiting on you until the person asks to merge", () => {
  // Queued at 09:40, merge asked for at 09:50, overlapping a question open from 09:45 to 09:55.
  const manual = runParts({ ...run(60), mergeQueuedAt: at(40), mergeRequestedAt: at(50) }, [{ createdAt: at(45), answeredAt: at(55) }], [], []);
  expect(manual.waitingMs).toBe(15 * MIN);
  // Auto merging needs no request, so nobody was waited on.
  const auto = runParts({ ...run(60), mergeQueuedAt: at(40), mergeRequestedAt: null }, [], [], []);
  expect(auto.waitingMs).toBe(0);
});

/** An execution created at `created` minutes that spent `queued` minutes ready and not running. */
const execution = (created: number, queued: number, costUsd: number | null = null) => ({
  createdAt: at(created),
  runnableAt: at(created),
  claimedAt: at(created + queued),
  queuedMs: queued * MIN,
  costUsd,
});

test("agent time is the wall time less waiting and queue, never below zero", () => {
  // The start execution waited 5 minutes for a worker before the run started at 09:00, then 3 more inside it.
  const parts = runParts(run(60), [{ createdAt: at(10), answeredAt: at(30) }], [], [execution(-5, 8), execution(20, 4)]);
  expect(parts).toMatchObject({ wallMs: 60 * MIN, waitingMs: 20 * MIN, queueMs: 7 * MIN, agentMs: 33 * MIN });

  const swamped = runParts(run(10), [{ createdAt: at(0), answeredAt: at(8) }], [], [execution(1, 5)]);
  expect(swamped).toMatchObject({ wallMs: 10 * MIN, waitingMs: 8 * MIN, queueMs: 5 * MIN, agentMs: 0 });
});

/** A measured run of `agent`, `queue` and `waiting` minutes that cost `costUsd`. */
const sample = (agent: number, queue: number, waiting: number, costUsd: number) => ({
  wallMs: (agent + queue + waiting) * MIN,
  agentMs: agent * MIN,
  queueMs: queue * MIN,
  waitingMs: waiting * MIN,
  costUsd,
});

test("usually is the median wall time and the parts add up to it", () => {
  // Wall times 40, 50, 60, 70 and 100 minutes; over all five, agent 200, queue 40 and waiting 80 minutes of 320.
  const samples = [sample(30, 10, 0, 1), sample(30, 0, 20, 2), sample(40, 10, 10, 3), sample(50, 10, 10, 4), sample(50, 10, 40, 10)];
  const forecast = forecastOf(samples, "M");
  expect(forecast).toEqual({ size: "M", source: "runs", minutes: 60, parts: { agent: 37.5, queue: 7.5, waiting: 15 }, costUsd: 3, runs: 5, measuredMinutes: 60 });

  // An even count takes the mean of the middle two, as percentile_cont(0.5) does.
  expect(forecastOf([...samples, sample(80, 0, 0, 5)], "M")).toMatchObject({ minutes: 65, costUsd: 3.5, runs: 6 });
});
