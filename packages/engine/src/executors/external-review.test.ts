import { expect, test } from "vitest";
import { reviewRequestMarker, type PrSnapshot } from "@handoff/github";
import { answeredAlreadyReviewed, reviewThreadsSettings, sameCodeAs } from "./external-review.ts";

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

/** CodeRabbit's answer to "@coderabbitai review" on northMES/northmes#319 at 911a22f, a merge of main on top of an unreviewed fix. */
const ALREADY_REVIEWED = [
  "<!-- This is an auto-generated reply by CodeRabbit -->",
  "<!-- CodeRabbit review command invocation: v2:ebb337643578e281bd02c5f52f8a658ba39a540cb1b3c66305e2b67330ddf482 -->",
  "<details>",
  "<summary>⚠️ Action not completed</summary>",
  "",
  "Already reviewed the last commit. Use `@coderabbitai full review` to rerun a review of the entire changeset.",
  "",
  "> Note: CodeRabbit is an incremental review system and does not re-review already reviewed commits. This command is applicable only when automatic reviews are paused.",
  "",
  "</details>",
].join("\n");

type Comment = PrSnapshot["comments"][number];
const commentBy = (author: string, body: string, authorBot = author.startsWith("coderabbitai")): Comment => ({ author, authorBot, body, url: "u", createdAt: "", updatedAt: "" });
const requestFor = (sha: string) => commentBy("octocat", `@coderabbitai review\n\n${reviewRequestMarker(sha)}`);
const withComments = (comments: Comment[]) => ({ headSha: "911a22f", comments }) as unknown as PrSnapshot;

test("CodeRabbit's 'Already reviewed' reply to handoff's request for the head is read from the bot only", () => {
  expect(answeredAlreadyReviewed(withComments([requestFor("911a22f"), commentBy("coderabbitai", ALREADY_REVIEWED)]), "coderabbitai[bot]")).toBe(true);
  // REST and GraphQL name the bot differently; both match.
  expect(answeredAlreadyReviewed(withComments([requestFor("911a22f"), commentBy("coderabbitai[bot]", ALREADY_REVIEWED)]), "coderabbitai")).toBe(true);
  // Small changes in wording still match.
  for (const text of ["Already reviewed the latest commit.", "This commit has already been reviewed.", "ALREADY  REVIEWED"]) {
    expect(answeredAlreadyReviewed(withComments([requestFor("911a22f"), commentBy("coderabbitai", text)]), "coderabbitai")).toBe(true);
  }
  // A person who writes the same words, or a user account with the bot's name, is not the bot.
  expect(answeredAlreadyReviewed(withComments([requestFor("911a22f"), commentBy("octocat", ALREADY_REVIEWED)]), "coderabbitai")).toBe(false);
  expect(answeredAlreadyReviewed(withComments([requestFor("911a22f"), commentBy("coderabbitai", ALREADY_REVIEWED, false)]), "coderabbitai")).toBe(false);
  // Another reply from the bot is not this one.
  expect(answeredAlreadyReviewed(withComments([requestFor("911a22f"), commentBy("coderabbitai", "Review triggered.")]), "coderabbitai")).toBe(false);
});

test("an 'Already reviewed' reply counts only after handoff's request for the head commit", () => {
  // The reply to the request for an earlier head says nothing about this one.
  expect(answeredAlreadyReviewed(withComments([requestFor("33045f2"), commentBy("coderabbitai", ALREADY_REVIEWED)]), "coderabbitai")).toBe(false);
  expect(answeredAlreadyReviewed(withComments([requestFor("33045f2"), commentBy("coderabbitai", ALREADY_REVIEWED), requestFor("911a22f")]), "coderabbitai")).toBe(false);
  // Without handoff's request for the head, a reply to someone else's request does not count either.
  expect(answeredAlreadyReviewed(withComments([commentBy("octocat", "@coderabbitai review"), commentBy("coderabbitai", ALREADY_REVIEWED)]), "coderabbitai")).toBe(false);
});
