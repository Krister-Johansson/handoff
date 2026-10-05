import { expect, test } from "vitest";
import { reviewThreadsSettings } from "./external-review.ts";

const reply = { reviewThreads: { reply: true } };

test("a bot's next review is waited for as long as the review time limit, 30 minutes unless set, and a person's for 24 hours", () => {
  expect(reviewThreadsSettings(reply)).toMatchObject({ botWaitMs: 30 * 60_000, personWaitMs: 24 * 3_600_000 });
  expect(reviewThreadsSettings({ ...reply, reviewTimeoutMinutes: 45 })).toMatchObject({ botWaitMs: 45 * 60_000 });
  expect(reviewThreadsSettings({ reviewThreads: { reply: true, personWaitHours: 8 } })).toMatchObject({ personWaitMs: 8 * 3_600_000 });
});

test("a graph that still sets botWaitMinutes waits for bots as long as the review time limit", () => {
  expect(reviewThreadsSettings({ reviewTimeoutMinutes: 20, reviewThreads: { reply: true, botWaitMinutes: 90 } })).toMatchObject({ botWaitMs: 20 * 60_000 });
});
