import { expect, test } from "vitest";
import { runParts } from "./forecast";

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
