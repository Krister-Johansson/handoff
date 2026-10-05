import { afterAll, beforeEach, expect, test } from "vitest";
import { appendEvents, reviewItems } from "@handoff/db";
import { createTestDb, seedExecution, seedRun, truncateAll } from "@handoff/db/testing";
import { reReviewWaits, runReviewItems, threadNotes } from "./review-items.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const repliedAt = new Date("2026-10-05T14:31:00Z");

async function seedItems(runId: string) {
  await db.insert(reviewItems).values([
    {
      runId,
      handle: 1,
      key: "thread:PRRT_1",
      kind: "thread",
      githubId: "PRRT_1",
      reviewer: "coderabbitai",
      reviewerBot: true,
      path: "src/catalog.ts",
      line: 47,
      url: "https://github.com/o/r/pull/9#discussion_r1",
      outdated: true,
      body: "create_task has no input schema.",
      round: 2,
      verdict: "fixed",
      evidence: "The test passes now.",
      fixCommit: "4e1a9c2d0b",
      replyUrl: "https://github.com/o/r/pull/9#discussion_r5",
      repliedAt,
      state: "awaiting_review",
    },
    { runId, handle: 2, key: "note:abc", kind: "summary_note", reviewer: "coderabbitai", reviewerBot: true, body: "Approval cards show raw JSON.", round: 2, verdict: "duplicate", evidence: "Same as R1.", duplicateOf: 1, state: "resolved", resolvedBy: "summary_dropped", resolvedAt: repliedAt },
    { runId, handle: 3, key: "thread:PRRT_3", kind: "thread", githubId: "PRRT_3", reviewer: "alice", path: "README.md", line: 3, body: "Say how to run it.", round: 2, state: "reraised", reraisedAs: 4 },
  ]);
}

test("the run page reads each review item with links to its commit, and handles for the items it repeats or follows", async () => {
  const { run } = await seedRun(db, { status: "waiting" });
  await seedItems(run.id);
  const items = await runReviewItems(db, run.id, { owner: "o", name: "r" });
  expect(items.map((i) => i.id)).toEqual(["R1", "R2", "R3"]);
  expect(items[0]).toMatchObject({
    kind: "thread",
    reviewerBot: true,
    outdated: true,
    commit: "4e1a9c2d0b",
    commitUrl: "https://github.com/o/r/commit/4e1a9c2d0b",
    replyUrl: "https://github.com/o/r/pull/9#discussion_r5",
    repliedAt: repliedAt.toISOString(),
    waitUntil: null,
    state: "awaiting_review",
  });
  expect(items[1]).toMatchObject({ duplicateOf: "R1", resolvedBy: "summary_dropped" });
  expect(items[2]).toMatchObject({ reraisedAs: "R4", commit: null, commitUrl: null });
});

test("the merge step's unresolved threads name the item each belongs to and why it is the person's now", async () => {
  const { run } = await seedRun(db, { status: "waiting" });
  await seedItems(run.id);
  const items = await runReviewItems(db, run.id, { owner: "o", name: "r" });
  const left = { ...items[0]!, state: "left" as const };
  const failed = { ...items[2]!, url: "https://github.com/o/r/pull/9#discussion_r3", state: "awaiting_review" as const, stateReason: "the credential may not resolve this thread" };
  expect(threadNotes([left, failed, items[1]!])).toEqual({
    "https://github.com/o/r/pull/9#discussion_r1": "R1, left to you",
    "https://github.com/o/r/pull/9#discussion_r3": "R3, handoff cannot resolve it",
  });
});

test("a PR step that waits for a reviewer's next review says whose, how many, since when and until when, and the items get their limit", async () => {
  const { run } = await seedRun(db, { status: "waiting" });
  await seedItems(run.id);
  const pr = await seedExecution(db, run.id, { nodeKey: "pr", nodeType: "pr", executorKind: "github", status: "waiting", waitKind: "github_pr" });
  const until = "2026-10-05T15:01:00.000Z";
  const look = (reReview: boolean) => [
    { type: "github.pr", payload: { number: 9 }, nodeExecutionId: pr.id },
    ...(reReview ? [{ type: "github.re_review", payload: { number: 9, reviewers: ["coderabbitai"], items: ["R1"], until, due: { R1: until } }, nodeExecutionId: pr.id }] : []),
  ];
  await db.transaction((tx) => appendEvents(tx, run.id, look(true)));

  const waits = await reReviewWaits(db, [run.id]);
  expect(waits.get(run.id)).toEqual({ nodeExecutionId: pr.id, reviewers: [{ login: "coderabbitai", bot: true }], items: 1, since: repliedAt, until: new Date(until), due: { R1: until } });
  expect((await runReviewItems(db, run.id, { owner: "o", name: "r" }, waits.get(run.id)))[0]!.waitUntil).toBe(until);

  // A later look that waits on CI alone.
  await db.transaction((tx) => appendEvents(tx, run.id, look(false)));
  expect((await reReviewWaits(db, [run.id])).get(run.id)).toBeUndefined();
});
