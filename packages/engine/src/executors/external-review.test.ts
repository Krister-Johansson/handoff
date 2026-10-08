import { expect, test } from "vitest";
import { reviewThreadsSettings, sameCodeAs } from "./external-review.ts";

const reply = { reviewThreads: { reply: true } };

test("a bot's next review is waited for as long as the review time limit, 30 minutes unless set, and a person's for 24 hours", () => {
  expect(reviewThreadsSettings(reply)).toMatchObject({ botWaitMs: 30 * 60_000, personWaitMs: 24 * 3_600_000 });
  expect(reviewThreadsSettings({ ...reply, reviewTimeoutMinutes: 45 })).toMatchObject({ botWaitMs: 45 * 60_000 });
  expect(reviewThreadsSettings({ reviewThreads: { reply: true, personWaitHours: 8 } })).toMatchObject({ personWaitMs: 8 * 3_600_000 });
});

test("a graph that still sets botWaitMinutes waits for bots as long as the review time limit", () => {
  expect(reviewThreadsSettings({ reviewTimeoutMinutes: 20, reviewThreads: { reply: true, botWaitMinutes: 90 } })).toMatchObject({ botWaitMs: 20 * 60_000 });
});

test("a review holds through a chain of handoff's catch-up merges, and a commit handoff did not record ends the chain", () => {
  // As on northMES/northmes#305: the summary covered 8fe766d, and handoff then merged main twice, into 4a87999 and e3b555f.
  const merges = new Map([
    ["e3b555f", "4a87999"],
    ["4a87999", "8fe766d"],
    ["8fe766d", "a0ff04c"],
  ]);
  const same = sameCodeAs("E3B555F", merges);
  expect(["e3b555f", "4a87999", "8fe766d", "a0ff04c"].map(same)).toEqual([true, true, true, true]);
  expect(same("d89a407")).toBe(false);
  expect(same(null)).toBe(false);
  // A merge of main on top of the coder's fix 2f765b5: a review of the commit before the fix does not hold.
  expect(sameCodeAs("m1", new Map([["m1", "2f765b5"]]))("e84bf3d")).toBe(false);
});
