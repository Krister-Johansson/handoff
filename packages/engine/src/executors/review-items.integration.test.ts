import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import type { ReviewAnswer, ReviewItem } from "@handoff/core";
import { and, eq, isNull, questions, wakeByKey } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import type { RepoRef } from "@handoff/github";
import { FakeGitHub } from "@handoff/github/testing";
import { answerQuestion } from "../operations.ts";
import { createRun } from "../runs.ts";
import { reviewRoundOf, withAnswers } from "../review-answers.ts";
import { createOriginRepo, git } from "../testing/git.ts";
import { drain, engineDeps, inspect, seedGraph } from "../testing/harness.ts";
import type { ExecutorContext, NodeExecutor } from "../types.ts";
import { GitWorktreeProvider } from "../workdir/git-worktree.ts";
import { mergeNodeExecutor, prNodeExecutor } from "./github.ts";
import { handleOf, listItems } from "./review-items.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const plannerOut = { plan: "p", steps: [], ownedPaths: ["CHANGELOG.md"] };
const planner: NodeExecutor = { needsWorkdir: false, execute: async () => ({ kind: "completed", output: plannerOut, statePatch: { plan: plannerOut } }) };

const graph = (prConfig: Record<string, unknown>) => ({
  attributes: { startNode: "planner" },
  nodes: [
    { key: "planner", attributes: { type: "planner", x: 0, y: 0 } },
    { key: "coder", attributes: { type: "coder", x: 0, y: 0 } },
    { key: "pr", attributes: { type: "pr", config: prConfig, x: 0, y: 0 } },
    { key: "merge", attributes: { type: "merge", x: 0, y: 0 } },
  ],
  edges: [
    { key: "planner->coder", source: "planner", target: "coder", attributes: { port: "done" } },
    { key: "coder->pr", source: "coder", target: "pr", attributes: { port: "done" } },
    { key: "pr->merge", source: "pr", target: "merge", attributes: { port: "ready" } },
    { key: "pr->coder", source: "pr", target: "coder", attributes: { port: "fix", input: "feedback" } },
  ],
});

/** Answers threads and reviews with replies on: the PR node waits for CodeRabbit and answers on GitHub. */
const replies = { waitForReviewers: ["coderabbitai"], reviewThreads: { reply: true } };

/** Commits a change to CHANGELOG.md in the run's worktree and returns the commit. */
function commitChange(ctx: ExecutorContext, text: string): string {
  writeFileSync(join(ctx.workdir!.path, "CHANGELOG.md"), `# Changelog\n\n${text}\n`);
  git(ctx.workdir!.path, "add", "-A");
  git(ctx.workdir!.path, "commit", "-qm", text);
  return git(ctx.workdir!.path, "rev-parse", "HEAD");
}

type Answer = (item: ReviewItem, ctx: ExecutorContext) => Omit<ReviewAnswer, "id">;

/** A declined answer with the evidence a coder gives. */
const decline: Answer = () => ({ verdict: "declined", evidence: "`pnpm test` passes with the integration project; vitest.config.ts:12 lists it." });

/**
 * A coder that writes the change on its first attempt and later answers every review comment in its
 * packet with `answer`, keeping its answers in run state as the coder executor does.
 */
function answeringCoder(answer: Answer, onCall?: (call: number) => void): NodeExecutor {
  let call = 0;
  return {
    needsWorkdir: true,
    async execute(ctx) {
      onCall?.(++call);
      const items = ctx.packet.reviewItems ?? [];
      if (items.length === 0) {
        commitChange(ctx, `Attempt ${ctx.execution.attempt}`);
        return { kind: "completed", output: { status: "done", summary: "Added CHANGELOG.md" } };
      }
      const answers = items.map((item) => ({ id: item.id, ...answer(item, ctx) }));
      const reviewAnswers = withAnswers(ctx.state, reviewRoundOf(ctx.state, ["pr"]), answers);
      return { kind: "completed", output: { status: "done", summary: "Answered the review comments", answers }, ...(reviewAnswers ? { statePatch: { reviewAnswers } } : {}) };
    },
  };
}

/** A run whose PR node waits for CI; CI then passes, and `wake` lets the PR node look again. */
async function opened(prConfig: Record<string, unknown>, coder: NodeExecutor, github = new FakeGitHub(), prExecutor?: NodeExecutor) {
  const origin = createOriginRepo();
  github.origin = origin;
  const { project, graphVersion } = await seedGraph(db, graph(prConfig), { localClonePath: origin });
  const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Add a CHANGELOG.md" });
  const workdirs = new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) });
  // A fresh PR executor for each pass, as a restarted worker would have.
  const deps = () => engineDeps(db, { planner, coder, pr: prExecutor ?? prNodeExecutor({ github, db }), merge: mergeNodeExecutor({ github }) }, { workdirs });
  await drain(deps());
  github.setChecks(1, "SUCCESS");
  const wake = async () => {
    await wakeByKey(db, "gh:pr:42:1", { reason: "webhook" });
    await drain(deps());
  };
  const pr = () => github.prs.get(1)!;
  /** A person answers the run's open question, and the run goes on. */
  const answer = async (input: Omit<Parameters<typeof answerQuestion>[2], "answeredBy">) => {
    const [open] = await db.select().from(questions).where(and(eq(questions.runId, run.id), isNull(questions.answer)));
    await answerQuestion(db, open!.id, { answeredBy: "krister", ...input });
    await drain(deps());
  };
  return { origin, github, run, wake, pr, answer };
}

const coderAttempt = async (runId: string, attempt: number) => (await inspect(db, runId)).executions.find((e) => e.nodeKey === "coder" && e.attempt === attempt);

test("a reviewer's thread becomes item R1 and reaches the coder with its handle", async () => {
  const { github, run, wake } = await opened(replies, answeringCoder(decline));
  github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED", threads: [{ path: "vitest.config.ts", line: 12, body: "The integration project never runs in CI." }] });
  await wake();

  const packet = (await coderAttempt(run.id, 2))?.contextPacket as { reviewItems?: ReviewItem[] };
  expect(packet.reviewItems).toEqual([
    expect.objectContaining({ id: "R1", kind: "thread", author: "coderabbitai", path: "vitest.config.ts", line: 12, body: "The integration project never runs in CI." }),
  ]);
  const sent = (await inspect(db, run.id)).executions.find((e) => e.nodeKey === "pr" && e.attempt === 1)?.output as { feedback: { review: { comments: unknown[] } } };
  expect(sent.feedback.review.comments).toEqual([expect.objectContaining({ item: "R1", kind: "thread" })]);
});

/** The comments in the pull request's only review thread after its first. */
const repliesIn = (github: FakeGitHub) => github.prs.get(1)!.reviewThreads[0]!.comments.slice(1);

test("a declined answer is posted as a reply in the thread with the evidence and the hidden marker", async () => {
  const { github, run, wake, pr } = await opened(replies, answeringCoder(decline));
  github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED", threads: [{ path: "vitest.config.ts", line: 12, body: "The integration project never runs in CI." }] });
  await wake();

  const head = pr().headSha;
  expect(repliesIn(github)).toHaveLength(1);
  const reply = repliesIn(github)[0]!.body;
  expect(reply.split("\n")[0]).toBe("Not changed: the comment does not hold.");
  expect(reply).toContain("`pnpm test` passes with the integration project; vitest.config.ts:12 lists it.");
  expect(reply).toContain(`Answered by handoff run \`${run.id}\`.`);
  expect(reply.trimEnd().split("\n").at(-1)).toBe(`<!-- handoff:item-reply R1 ${head} -->`);
  expect((await inspect(db, run.id)).events.find((e) => e.type === "github.item_answered")?.payload).toMatchObject({ item: "R1", verdict: "declined", found: false });
});

/** A FakeGitHub that notes, at each reply, which commits the origin repository has. */
class WatchedGitHub extends FakeGitHub {
  readonly onOrigin: string[][] = [];
  override async replyToThread(repo: RepoRef, threadId: string, body: string) {
    this.onOrigin.push(git(this.origin!, "log", "--all", "--format=%H").split("\n"));
    return super.replyToThread(repo, threadId, body);
  }
}

test("a fixed answer's reply names the commit and is posted after the push", async () => {
  let fix = "";
  const fixing: Answer = (_item, ctx) => {
    fix = commitChange(ctx, "Run the integration project in CI");
    return { verdict: "fixed", evidence: "vitest.config.ts:12 left the integration project out of the CI run; it is in now.", commit: fix.slice(0, 7) };
  };
  const github = new WatchedGitHub();
  const { run, wake } = await opened(replies, answeringCoder(fixing), github);
  github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED", threads: [{ path: "vitest.config.ts", line: 12, body: "The integration project never runs in CI." }] });
  await wake();

  const reply = repliesIn(github)[0]!.body;
  expect(reply.split("\n")[0]).toBe(`Valid. Fixed in [${fix.slice(0, 7)}](https://github.com/octo/sample/commit/${fix}).`);
  expect(reply).toContain("vitest.config.ts:12 left the integration project out of the CI run; it is in now.");
  expect(reply).toContain(`<!-- handoff:item-reply R1 ${fix} -->`);
  // The fix was on GitHub when the reply named it.
  expect(github.onOrigin).toHaveLength(1);
  expect(github.onOrigin[0]).toContain(fix);
  expect((await inspect(db, run.id)).executions.filter((e) => e.nodeKey === "pr").map((e) => e.attempt)).toEqual([1, 2]);
});

test("a reply handoff posted never comes back as feedback", async () => {
  // The coder fixes the thread and declines the review summary, so handoff answers in the thread and in a PR comment.
  const answer: Answer = (item, ctx) =>
    item.kind === "thread" ? { verdict: "fixed", evidence: "The integration project was left out; it runs now.", commit: commitChange(ctx, "Run the integration project in CI") } : decline(item, ctx);
  const { github, run, wake, pr } = await opened(replies, answeringCoder(answer));
  github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED", body: "Actionable comments posted: 1", threads: [{ path: "vitest.config.ts", line: 12, body: "The integration project never runs in CI." }] });
  await wake();
  expect(repliesIn(github)).toHaveLength(1);
  expect(pr().comments.filter((c) => c.body.includes("<!-- handoff:item-answers"))).toHaveLength(1);

  // CodeRabbit reviews the fix and opens one new thread; the earlier one is still unresolved, with handoff's reply in it.
  github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED", threads: [{ path: "CHANGELOG.md", line: 3, body: "Name the CI job." }] });
  await wake();

  const packet = (await coderAttempt(run.id, 3))?.contextPacket as { reviewItems?: ReviewItem[]; priorAttempt?: { reviewComments: { body: string }[] } };
  expect(packet.reviewItems?.map((i) => [i.id, i.body])).toEqual([["R3", "Name the CI job."]]);
  const told = JSON.stringify(packet);
  expect(told).not.toContain("<!-- handoff:");
  expect(told).not.toContain("Answered by handoff");
  const pr2 = (await inspect(db, run.id)).executions.find((e) => e.nodeKey === "pr" && e.attempt === 2)?.output;
  expect(JSON.stringify(pr2)).not.toContain("<!-- handoff:");
});

/** CodeRabbit's summary comment for `head`, with a walkthrough note under `risk` and the failed pre-merge checks given. */
function summaryOf(head: string, opts: { risk?: string; note: string; failed?: { name: string; explanation: string; resolution: string }[] }) {
  const failed = opts.failed ?? [];
  return [
    "<!-- This is an auto-generated comment: summarize by coderabbit.ai -->",
    "<!-- walkthrough_start -->",
    "## Walkthrough",
    "",
    "The change adds a changelog.",
    "<!-- walkthrough_end -->",
    "<!-- final_review_risk_start -->",
    `**Merge Risk:** _${opts.risk ?? "🔵 Low"}_ · up to \`${head.slice(0, 5)}\``,
    `<!-- final_review_risk_coverage:{"sourceCommitId":"${head}","coveredCommitId":"${head}","kind":"reviewed"} -->`,
    "",
    opts.note,
    "<!-- final_review_risk_end -->",
    "<!-- pre_merge_checks_walkthrough_start -->",
    "",
    "<details>",
    `<summary>🚥 Pre-merge checks | ✅ 4 | ❌ ${failed.length}</summary>`,
    "",
    ...(failed.length
      ? [
          `### ❌ Failed checks (${failed.length} warning)`,
          "",
          "| Check name | Status | Explanation | Resolution |",
          "| :---: | :--- | :--- | :--- |",
          ...failed.map((c) => `| ${c.name} | ⚠️ Warning | ${c.explanation.slice(0, 20)}… | ${c.resolution.slice(0, 20)}… |`),
          "",
          ...failed.flatMap((c) => ["<details>", `<summary>Full details: ${c.name}</summary>`, "", "**Explanation**", "", c.explanation, "", "**Resolution**", "", c.resolution, "", "</details>", ""]),
        ]
      : []),
    "<details>",
    "<summary>✅ Passed checks (4 passed)</summary>",
    "",
    "| Check name | Status | Explanation |",
    "| :---: | :--- | :--- |",
    "| Linked Issues check | ✅ Passed | Check skipped because no linked issues were found for this pull request. |",
    "",
    "</details>",
    "",
    "</details>",
    "",
    "<!-- pre_merge_checks_walkthrough_end -->",
  ].join("\n");
}

const withSummary = { waitForReviewers: ["coderabbitai"], reviewThreads: { reply: true, summary: "coderabbitai" } };

test("review summaries, summary notes and pre-merge checks are answered in one PR comment per round", async () => {
  const title = { name: "Title check", explanation: "The title names the branch, not the change it makes.", resolution: "Use a title that says what the change does for users." };
  const note = "The changelog omits the date of the release, which the release workflow reads.";
  const github = new FakeGitHub();
  const answer: Answer = (item) =>
    item.kind === "summary_note"
      ? { verdict: "duplicate", evidence: "The review asks for the same date.", of: "R1" }
      : { verdict: "declined", evidence: `Checked ${item.kind}: CHANGELOG.md:1 has the date and the title states the change.` };
  // While the coder answers the first round, CodeRabbit leaves another review summary on the same commit.
  const coder = answeringCoder(answer, (call) => {
    if (call === 2) github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED", body: "The heading level is inconsistent." });
  });
  const { run, wake, pr } = await opened(withSummary, coder, github);
  const head = pr().headSha;
  github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED", body: "The changelog entry needs a release date." });
  // Without a summary of the head commit, the PR step waits for it like a listed reviewer.
  await wake();
  expect((await inspect(db, run.id)).executions.find((e) => e.nodeKey === "pr")?.status).toBe("waiting");
  github.summaryComment(1, summaryOf(head, { note, failed: [title] }));
  await wake();

  const packet = (await coderAttempt(run.id, 2))?.contextPacket as { reviewItems?: ReviewItem[] };
  expect(packet.reviewItems?.map((i) => [i.id, i.kind])).toEqual([
    ["R1", "review_body"],
    ["R2", "summary_note"],
    ["R3", "pre_merge_check"],
  ]);
  expect(packet.reviewItems?.[2]?.body).toContain("Use a title that says what the change does for users.");

  const answers = pr().comments.filter((c) => c.body.includes("<!-- handoff:item-answers"));
  expect(answers).toHaveLength(2);
  const [first, second] = answers.map((c) => c.body);
  expect(first).toContain(`<!-- handoff:item-answers 1 ${head} -->`);
  expect(first).toContain("**Review by coderabbitai:** The changelog entry needs a release date.");
  expect(first).toContain(`**Summary note by coderabbitai:** ${note}`);
  expect(first).toContain(`Same point as [the review by coderabbitai](${pr().url}).`);
  expect(first).toContain("**Pre-merge check by coderabbitai:** Title check (warning): The title names the branch, not the change it makes.");
  expect(first?.match(/^Not changed: the comment does not hold\.$/gm)).toHaveLength(2);
  expect(first).toContain("Checked pre_merge_check: CHANGELOG.md:1 has the date and the title states the change.");
  expect(second).toContain(`<!-- handoff:item-answers 2 ${head} -->`);
  expect(second).toContain("**Review by coderabbitai:** The heading level is inconsistent.");
  expect(second).not.toContain("release date");
  // Nothing went into a thread, and the run merged once every round was answered.
  expect(pr().reviewThreads).toEqual([]);
  expect(github.merged).toEqual([1]);
});

test("a pre-merge check fixed through the title without a commit is answered as fixed, with what changed", async () => {
  const title = { name: "Title check", explanation: "The title names the branch, not the change it makes.", resolution: "Use a title that says what the change does for users." };
  const answer: Answer = (item) => (item.kind === "pre_merge_check" ? { verdict: "fixed", evidence: 'The PR title is now "Add a CHANGELOG.md with the release date".' } : decline(item, undefined as never));
  const github = new FakeGitHub();
  const { run, wake, pr } = await opened(withSummary, answeringCoder(answer), github);
  const head = pr().headSha;
  github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED" });
  github.summaryComment(1, summaryOf(head, { note: "The changelog omits the date of the release.", failed: [title] }));
  await wake();

  const said = pr().comments.find((c) => c.body.includes("<!-- handoff:item-answers"))!.body;
  expect(said).toContain('**Pre-merge check by coderabbitai:** Title check (warning)');
  expect(said).toMatch(/^Valid\. Fixed\.$/m);
  expect(said).toContain('The PR title is now "Add a CHANGELOG.md with the release date".');
  expect(said).not.toContain("Fixed in");
  expect((await itemsOf(run.id)).R2).toMatchObject({ verdict: "fixed", fixCommit: null });
});

test("a summary note that finds no merge-blocking issue under a Minimal risk is not sent to the coder", async () => {
  const { github, run, wake, pr } = await opened(withSummary, answeringCoder(decline));
  github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED" });
  github.summaryComment(1, summaryOf(pr().headSha, { risk: "⚪ Minimal", note: "The updated changelog has no identified merge-blocking issue." }));
  await wake();
  expect(await coderAttempt(run.id, 2)).toBeUndefined();
  expect(github.merged).toEqual([1]);
});

test("the summary bot's own check is its review in progress, not CI, and the step waits for the summary instead", async () => {
  // Not a listed reviewer: only the summary setting names CodeRabbit.
  const { github, run, wake, pr } = await opened({ sendReviewComments: true, reviewThreads: { reply: true, summary: "coderabbitai" } }, answeringCoder(decline));
  const running = { name: "CodeRabbit", status: "IN_PROGRESS", conclusion: null, url: "https://coderabbit.ai", checkRunId: 8 };
  pr().checks = { state: "PENDING", contexts: [{ name: "test", status: "COMPLETED", conclusion: "SUCCESS", url: "https://ci/7", checkRunId: 7 }, running] };
  await wake();
  const { executions, events } = await inspect(db, run.id);
  expect(executions.find((e) => e.nodeKey === "pr")?.status).toBe("waiting");
  expect(events.filter((e) => e.type === "github.pr").at(-1)?.payload).toMatchObject({ ci: "success" });
  expect(events.filter((e) => e.type === "github.reviewers").at(-1)?.payload).toMatchObject({ waitingFor: ["coderabbitai summary"], timedOut: false });

  // The summary of the head arrives while CodeRabbit's check still runs: the step goes on.
  github.summaryComment(1, summaryOf(pr().headSha, { risk: "⚪ Minimal", note: "No merge-blocking issue is identified." }));
  await wake();
  expect(github.merged).toEqual([1]);
});

test("without reviewThreads the PR node sends findings once and posts nothing, as before", async () => {
  const { github, run, wake, pr } = await opened({ waitForReviewers: ["coderabbitai"] }, answeringCoder(decline));
  github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED", body: "Actionable comments posted: 1", threads: [{ path: "vitest.config.ts", line: 12, body: "The integration project never runs in CI." }] });
  await wake();

  const packet = (await coderAttempt(run.id, 2))?.contextPacket as { reviewItems?: ReviewItem[]; priorAttempt?: { reviewComments: { body: string }[] } };
  expect(packet.reviewItems).toBeUndefined();
  expect(packet.priorAttempt?.reviewComments.map((c) => c.body)).toEqual(["The integration project never runs in CI.", "Actionable comments posted: 1"]);
  const sent = (await inspect(db, run.id)).executions.find((e) => e.nodeKey === "pr" && e.attempt === 1)?.output;
  expect(JSON.stringify(sent)).not.toContain('"item"');

  // CodeRabbit reviews the new commit without comments: the old thread is not sent again, and the run merges.
  github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED" });
  await wake();
  expect((await inspect(db, run.id)).executions.filter((e) => e.nodeKey === "coder")).toHaveLength(2);
  expect(github.merged).toEqual([1]);
  expect(repliesIn(github)).toEqual([]);
  expect(pr().comments).toEqual([]);
});

/** A FakeGitHub whose first reply reaches GitHub but whose answer is lost, as when the connection drops. */
class DroppingGitHub extends FakeGitHub {
  dropped = 0;
  override async replyToThread(repo: RepoRef, threadId: string, body: string) {
    const posted = await super.replyToThread(repo, threadId, body);
    if (this.dropped++ === 0) throw new Error("socket hang up");
    return posted;
  }
}

test("a PR step that restarts after posting does not post the same reply again", async () => {
  const github = new DroppingGitHub();
  // The worker dies right after the reply went out: its step is reclaimed and runs again from the push.
  const real = prNodeExecutor({ github, db });
  const dying: NodeExecutor = {
    needsWorkdir: true,
    async execute(ctx) {
      const before = github.dropped;
      const outcome = await real.execute(ctx);
      return before === 0 && github.dropped === 1 ? { kind: "interrupted" } : outcome;
    },
  };
  const { run, wake } = await opened(replies, answeringCoder(decline), github, dying);
  github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED", threads: [{ path: "vitest.config.ts", line: 12, body: "The integration project never runs in CI." }] });
  await wake();

  const { types, events, executions } = await inspect(db, run.id);
  expect(types).toContain("node.interrupted");
  expect(executions.find((e) => e.nodeKey === "pr" && e.attempt === 2)?.interruptCount).toBe(1);
  expect(repliesIn(github)).toHaveLength(1);
  expect(events.filter((e) => e.type === "github.item_answered").map((e) => e.payload)).toEqual([expect.objectContaining({ item: "R1", found: true, url: repliesIn(github)[0]!.url })]);
});

/** The run's review items as the PR node recorded them, by handle. */
const itemsOf = async (runId: string) => Object.fromEntries((await listItems(db, runId)).map((r) => [handleOf(r), r]));

const prStep = async (runId: string, attempt: number) => (await inspect(db, runId)).executions.find((e) => e.nodeKey === "pr" && e.attempt === attempt);

/** CodeRabbit's thread on vitest.config.ts:12, which the coder answers and handoff replies to; the PR step then waits for CodeRabbit's next review. */
async function declined(prConfig: Record<string, unknown> = replies, github = new FakeGitHub(), coder: NodeExecutor = answeringCoder(decline), setUp?: (github: FakeGitHub) => void) {
  const run = await opened(prConfig, coder, github);
  github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED", threads: [{ path: "vitest.config.ts", line: 12, body: "The integration project never runs in CI." }] });
  setUp?.(github);
  await run.wake();
  const thread = () => run.pr().reviewThreads[0]!;
  return { ...run, thread };
}

test("a review from the same reviewer after the reply that opens no thread on those lines resolves the thread", async () => {
  const { github, run, wake, pr, thread } = await declined({ ...replies, reviewRequest: { reviewer: "coderabbitai", afterMinutes: 0 } });
  expect(repliesIn(github)).toHaveLength(1);
  expect(thread().isResolved).toBe(false);
  expect((await prStep(run.id, 2))?.status).toBe("waiting");
  expect((await itemsOf(run.id)).R1?.state).toBe("awaiting_review");

  // CodeRabbit approves the same commit seconds after the reply, as on northMES/northmes#192.
  github.reviewOnHead(1, "coderabbitai", { state: "APPROVED" });
  await wake();

  expect(thread().isResolved).toBe(true);
  expect(thread().resolvedBy).toBe("octocat");
  expect((await itemsOf(run.id)).R1).toMatchObject({ state: "resolved", resolvedBy: "handoff" });
  const resolved = (await inspect(db, run.id)).events.find((e) => e.type === "github.item_resolved")?.payload;
  expect(resolved).toMatchObject({ item: "R1", by: "handoff", afterSeconds: expect.any(Number) });
  expect(github.merged).toEqual([1]);
  // The declined round asked for no review: the request goes out once per new commit, and this one had it already.
  expect(pr().comments.filter((c) => c.body.includes("<!-- handoff:review-request"))).toHaveLength(1);
});

test("an item records whether GitHub shows its thread as outdated, and nothing else follows from it", async () => {
  const { run, wake, thread } = await declined();
  expect((await itemsOf(run.id)).R1?.outdated).toBe(false);
  thread().isOutdated = true;
  await wake();
  expect((await itemsOf(run.id)).R1).toMatchObject({ outdated: true, state: "awaiting_review" });
  expect(thread().isResolved).toBe(false);
});

/** A FakeGitHub whose reviewer reviews the pushed commit just before handoff's reply reaches the thread. */
class QuickReviewer extends FakeGitHub {
  override async replyToThread(repo: RepoRef, threadId: string, body: string) {
    this.reviewOnHead(1, "coderabbitai", { state: "COMMENTED" });
    return super.replyToThread(repo, threadId, body);
  }
}

test("a thread is not resolved in the execution that pushed its fix, and not before a review submitted after the reply", async () => {
  const fixing: Answer = (_item, ctx) => ({ verdict: "fixed", evidence: "The integration project was left out; it runs now.", commit: commitChange(ctx, "Run the integration project in CI") });
  const github = new QuickReviewer();
  const { run, wake, thread } = await declined(replies, github, answeringCoder(fixing));
  expect(repliesIn(github)).toHaveLength(1);
  expect(thread().isResolved).toBe(false);
  expect((await prStep(run.id, 2))?.status).toBe("waiting");

  // CI news wakes the step; CodeRabbit's only review of the fix came before the reply.
  await wake();
  expect(thread().isResolved).toBe(false);
  expect((await itemsOf(run.id)).R1?.state).toBe("awaiting_review");

  github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED" });
  await wake();
  expect(thread().isResolved).toBe(true);
  expect((await itemsOf(run.id)).R1?.state).toBe("resolved");
  expect(github.merged).toEqual([1]);
});

test("a thread the reviewer resolved itself is recorded as resolved by the reviewer", async () => {
  const { github, run, wake, thread } = await declined();
  github.resolveThreadAs(1, thread().id!, "coderabbitai");
  await wake();

  expect((await itemsOf(run.id)).R1).toMatchObject({ state: "resolved", resolvedBy: "coderabbitai" });
  expect(thread().resolvedBy).toBe("coderabbitai");
  expect(github.merged).toEqual([1]);
});

test("a new thread from the reviewer on the same lines marks the old item re-raised and sends the new one to the coder", async () => {
  const { github, run, wake, pr } = await declined();
  github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED", threads: [{ path: "vitest.config.ts", line: 14, body: "The integration project still never runs in CI." }] });
  await wake();

  const items = await itemsOf(run.id);
  expect(items.R1).toMatchObject({ state: "reraised", reraisedAs: 2 });
  expect(items.R2).toMatchObject({ kind: "thread", line: 14 });
  const packet = (await coderAttempt(run.id, 3))?.contextPacket as { reviewItems?: ReviewItem[] };
  expect(packet.reviewItems?.map((i) => i.id)).toEqual(["R2"]);
  expect(pr().reviewThreads[0]!.isResolved).toBe(false);
  expect((await inspect(db, run.id)).events.find((e) => e.type === "github.item_reraised")?.payload).toMatchObject({ item: "R1", as: "R2" });

  // The coder declines the new thread too; once CodeRabbit lets it be, both threads are resolved.
  github.reviewOnHead(1, "coderabbitai", { state: "APPROVED" });
  await wake();
  expect(pr().reviewThreads.map((t) => t.isResolved)).toEqual([true, true]);
  expect(Object.values(await itemsOf(run.id)).map((r) => [r.state, r.resolvedBy])).toEqual([
    ["resolved", "handoff"],
    ["resolved", "handoff"],
  ]);
});

test("an old CHANGES_REQUESTED from a reviewer whose items await its review does not route to fix", async () => {
  const { github, run, wake } = await declined(replies, new FakeGitHub(), answeringCoder(decline), (gh) => {
    const pr = gh.prs.get(1)!;
    pr.reviews.at(-1)!.state = "CHANGES_REQUESTED";
    pr.reviewDecision = "CHANGES_REQUESTED";
  });
  expect((await prStep(run.id, 2))?.status).toBe("waiting");

  // CI news: the decision GitHub reports is still the old one, and the step keeps waiting for CodeRabbit.
  await wake();
  expect((await prStep(run.id, 2))?.status).toBe("waiting");
  expect(await coderAttempt(run.id, 3)).toBeUndefined();

  // CodeRabbit comments without raising the point again. With a ruleset that requires an approving review,
  // GitHub keeps reporting CHANGES_REQUESTED until CodeRabbit approves a later commit.
  github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED" });
  await wake();
  expect(await coderAttempt(run.id, 3)).toBeUndefined();
  expect((await itemsOf(run.id)).R1?.state).toBe("resolved");
  expect((await inspect(db, run.id)).events.find((e) => e.type === "github.changes_requested_answered")?.payload).toMatchObject({ reviewers: ["coderabbitai"] });
  expect(github.merged).toEqual([1]);
});

test("a summary note that the next summary no longer lists is resolved; a declined one it still lists is not sent again", async () => {
  const title = { name: "Title check", explanation: "The title names the branch, not the change it makes.", resolution: "Use a title that says what the change does for users." };
  const note = "The changelog omits the date of the release, which the release workflow reads.";
  const answer: Answer = (item, ctx) =>
    item.kind === "summary_note"
      ? { verdict: "fixed", evidence: "CHANGELOG.md had no date; it has one now.", commit: commitChange(ctx, "Date the release") }
      : { verdict: "declined", evidence: "The title says what the change does: Add a CHANGELOG.md." };
  const github = new FakeGitHub();
  const { run, wake, pr } = await opened(withSummary, answeringCoder(answer), github);
  github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED" });
  github.summaryComment(1, summaryOf(pr().headSha, { note, failed: [title] }));
  await wake();
  expect((await itemsOf(run.id)).R1?.state).toBe("awaiting_review");

  // CodeRabbit reviews the fix and edits its summary: the note is gone, the title check is still there.
  github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED" });
  github.summaryComment(1, summaryOf(pr().headSha, { risk: "⚪ Minimal", note: "The updated changelog has no identified merge-blocking issue.", failed: [title] }));
  await wake();

  const items = await itemsOf(run.id);
  expect(items.R1).toMatchObject({ kind: "summary_note", state: "resolved", resolvedBy: "summary_dropped" });
  expect(items.R2).toMatchObject({ kind: "pre_merge_check", state: "awaiting_review" });
  expect(await coderAttempt(run.id, 3)).toBeUndefined();
  expect(github.merged).toEqual([1]);
});

test("without viewerCanResolve the item keeps its state, an event names the thread, and the merge step's wait lists it", async () => {
  const github = new FakeGitHub();
  github.requireResolvedThreads = true;
  const { run, thread } = await declined(replies, github, answeringCoder(decline), (gh) => {
    gh.prs.get(1)!.reviewThreads[0]!.viewerCanResolve = false;
  });
  const url = thread().comments[0]!.url;

  expect(repliesIn(github)).toHaveLength(1);
  const { events, executions } = await inspect(db, run.id);
  expect((await itemsOf(run.id)).R1).toMatchObject({ state: "awaiting_review", stateReason: expect.stringContaining("may not resolve") });
  expect(events.find((e) => e.type === "github.thread_resolve_failed")?.payload).toMatchObject({ item: "R1", url });
  // The PR step stops waiting on it, and the merge step waits for a person to resolve it.
  expect(executions.find((e) => e.nodeKey === "pr" && e.attempt === 2)?.status).toBe("passed");
  expect(executions.find((e) => e.nodeKey === "merge")?.status).toBe("waiting");
  expect(events.find((e) => e.type === "merge.threads_unresolved")?.payload).toMatchObject({ threads: [expect.objectContaining({ url })] });
});

test("the step reports waiting_on re_review while items wait", async () => {
  const { run } = await declined();
  const { events, executions } = await inspect(db, run.id);
  const step = executions.find((e) => e.nodeKey === "pr" && e.attempt === 2)!;
  expect(step).toMatchObject({ status: "waiting", waitKind: "github_pr" });
  // The step's last word on GitHub in its latest look, which the dashboard and get_run read as waiting_on re_review.
  const mine = events.filter((e) => e.nodeExecutionId === step.id && e.type.startsWith("github."));
  expect(mine.at(-1)).toMatchObject({ type: "github.re_review", payload: { reviewers: ["coderabbitai"], items: ["R1"] } });
  // When the wait ends and a person is asked: the review time limit, 30 minutes, after handoff's answer.
  const answered = (await itemsOf(run.id)).R1!.repliedAt!;
  const until = Date.parse((mine.at(-1)!.payload as { until: string }).until);
  expect(Math.abs(until - (answered.getTime() + 30 * 60_000))).toBeLessThan(5_000);
  // And when each item's wait ends.
  expect((mine.at(-1)!.payload as { due: Record<string, string> }).due).toEqual({ R1: new Date(until).toISOString() });
});

/** The coder's answer to a review comment that came back with the reviewer's reply: settled when the reply accepts the answer. */
const settleOnReply: Answer = (item, ctx) => (item.conversation?.length ? { verdict: "settled", evidence: "The reviewer agrees that the config lists it." } : decline(item, ctx));

test("a reviewer reply goes to the coder with the thread; settled resolves it", async () => {
  const { github, run, wake, thread } = await declined(replies, new FakeGitHub(), answeringCoder(settleOnReply));
  github.replyInThread(1, thread().id!, "coderabbitai", "You are right, vitest.config.ts lists the integration project.");
  await wake();

  const packet = (await coderAttempt(run.id, 3))?.contextPacket as { reviewItems?: ReviewItem[] };
  expect(packet.reviewItems).toEqual([
    expect.objectContaining({
      id: "R1",
      body: "The integration project never runs in CI.",
      conversation: [
        { author: "handoff", body: expect.stringContaining("Not changed: the comment does not hold.") },
        { author: "coderabbitai", body: "You are right, vitest.config.ts lists the integration project." },
      ],
    }),
  ]);
  expect(JSON.stringify(packet.reviewItems)).not.toContain("<!-- handoff:");
  expect((await inspect(db, run.id)).events.find((e) => e.type === "github.item_reviewer_replied")?.payload).toMatchObject({ item: "R1" });

  // The coder settles it: handoff posts nothing more and resolves the thread at once.
  expect(repliesIn(github)).toHaveLength(2);
  expect(thread().isResolved).toBe(true);
  expect((await itemsOf(run.id)).R1).toMatchObject({ state: "resolved", resolvedBy: "handoff", verdict: "settled" });
  expect(github.merged).toEqual([1]);
});

/** The run's questions, oldest first. */
const questionsOf = async (runId: string) => (await db.select().from(questions).where(eq(questions.runId, runId))).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

/** CodeRabbit answers back in R1's thread after the coder declined it, and the coder declines it again: a person decides. */
async function disputed(prConfig: Record<string, unknown> = replies, github = new FakeGitHub(), coder: NodeExecutor = answeringCoder(decline)) {
  const run = await declined(prConfig, github, coder);
  github.replyInThread(1, run.thread().id!, "coderabbitai", "CI runs `pnpm test:unit` only, so the integration project is skipped.");
  await run.wake();
  return run;
}

test("a second decline makes the item disputed and asks one question with both sides and the choices resolve, send back and leave", async () => {
  const { github, run, thread } = await disputed();

  // handoff posts nothing more in the thread: its first answer and the reviewer's reply.
  expect(repliesIn(github).map((c) => c.author)).toEqual(["octocat", "coderabbitai"]);
  const [question, ...more] = await questionsOf(run.id);
  expect(more).toEqual([]);
  const step = await prStep(run.id, 3);
  expect(step).toMatchObject({ status: "waiting", waitKind: "human", waitToken: question!.id, waitKey: "gh:pr:42:1" });
  expect(question).toMatchObject({ nodeExecutionId: step!.id, options: ["resolve", "send_back", "leave"], answer: null });
  expect(question!.question).toContain("R1");
  expect(question!.context).toMatchObject({
    reason: "review_items",
    pr: { number: 1, url: expect.any(String) },
    items: [
      {
        id: "R1",
        kind: "thread",
        reviewer: "coderabbitai",
        path: "vitest.config.ts",
        line: 12,
        url: thread().comments[0]!.url,
        why: "disputed",
        comment: "The integration project never runs in CI.",
        conversation: [
          { author: "handoff", body: expect.stringContaining("Not changed: the comment does not hold.") },
          { author: "coderabbitai", body: "CI runs `pnpm test:unit` only, so the integration project is skipped." },
        ],
        verdict: "declined",
        evidence: "`pnpm test` passes with the integration project; vitest.config.ts:12 lists it.",
        replyUrl: repliesIn(github)[0]!.url,
      },
    ],
  });
  expect((await itemsOf(run.id)).R1).toMatchObject({ state: "disputed", questionId: question!.id });
  const { events } = await inspect(db, run.id);
  expect(events.find((e) => e.type === "github.item_disputed")?.payload).toMatchObject({ item: "R1" });
  expect(events.find((e) => e.type === "human.asked")?.payload).toMatchObject({ questionId: question!.id, options: ["resolve", "send_back", "leave"] });
  expect(github.merged).toEqual([]);
});

/** Moves the pull request's reviews and review comments back by `minutes`, as if that much time had passed since. */
function later(github: FakeGitHub, minutes: number) {
  const back = <T extends string | null | undefined>(iso: T) => (iso ? new Date(Date.parse(iso) - minutes * 60_000).toISOString() : iso) as T;
  const pr = github.prs.get(1)!;
  for (const review of pr.reviews) review.submittedAt = back(review.submittedAt);
  for (const comment of pr.reviewThreads.flatMap((t) => t.comments)) if (comment.createdAt) comment.createdAt = back(comment.createdAt);
}

test("a bot that does not review within 30 minutes, and a person within 24 hours, makes the step ask", async () => {
  const bot = await declined();
  later(bot.github, 29);
  await bot.wake();
  expect(await questionsOf(bot.run.id)).toEqual([]);
  expect((await prStep(bot.run.id, 2))?.status).toBe("waiting");

  later(bot.github, 2);
  await bot.wake();
  const [asked] = await questionsOf(bot.run.id);
  expect(asked?.context).toMatchObject({ reason: "review_items", items: [expect.objectContaining({ id: "R1", why: "no_review", reason: "no review from coderabbitai within 30 minutes of the answer" })] });
  expect((await itemsOf(bot.run.id)).R1).toMatchObject({ state: "disputed", questionId: asked!.id });
  expect((await prStep(bot.run.id, 2))?.status).toBe("waiting");
  expect((await prStep(bot.run.id, 2))?.waitKind).toBe("human");
  expect((await inspect(db, bot.run.id)).events.find((e) => e.type === "github.items_review_overdue")?.payload).toMatchObject({ items: [expect.objectContaining({ item: "R1", limitMinutes: 30 })] });
  expect(bot.github.merged).toEqual([]);

  await truncateAll(db);
  const github = new FakeGitHub();
  const person = await opened({ ...replies, waitForReviewers: ["alice"] }, answeringCoder(decline), github);
  github.reviewOnHead(1, "alice", { state: "COMMENTED", threads: [{ path: "vitest.config.ts", line: 12, body: "The integration project never runs in CI." }] });
  await person.wake();
  later(github, 23 * 60);
  await person.wake();
  expect(await questionsOf(person.run.id)).toEqual([]);

  later(github, 2 * 60);
  await person.wake();
  const [question] = await questionsOf(person.run.id);
  expect(question?.context).toMatchObject({ items: [expect.objectContaining({ id: "R1", reviewer: "alice", why: "no_review", reason: "no review from alice within 1440 minutes of the answer" })] });
  expect(github.merged).toEqual([]);
});

test("resolve resolves the thread and the run goes on", async () => {
  const { github, run, thread, answer } = await disputed();
  await answer({ answer: "The unit project covers it; ADR 0041 keeps integration tests out of CI.", option: "resolve" });

  expect(thread().isResolved).toBe(true);
  const said = repliesIn(github).at(-1)!;
  expect(said.author).toBe("octocat");
  expect(said.body.split("\n")[0]).toBe("Resolved by krister in handoff.");
  expect(said.body).toContain("The unit project covers it; ADR 0041 keeps integration tests out of CI.");
  expect(said.body).toContain("<!-- handoff:item-decision R1 ");
  expect((await itemsOf(run.id)).R1).toMatchObject({ state: "resolved", resolvedBy: "krister" });
  expect((await prStep(run.id, 3))?.status).toBe("passed");
  expect(await coderAttempt(run.id, 4)).toBeUndefined();
  expect(github.merged).toEqual([1]);
});

type Decided = { reviewItems?: ReviewItem[]; decisions?: { gate: string; note?: string }[] };

test("send back gives the coder the item with the person's note as a decision", async () => {
  // The coder declines until a person decides; then it fixes the comment.
  const fixOnDecision: Answer = (item, ctx) =>
    (ctx.packet as Decided).decisions?.length ? { verdict: "fixed", evidence: "CI now runs the integration project.", commit: commitChange(ctx, "Run the integration project in CI") } : decline(item, ctx);
  const { github, run, answer } = await disputed(replies, new FakeGitHub(), answeringCoder(fixOnDecision));
  const note = "CI runs test:unit only; add the integration project to the CI job.";
  await answer({ answer: "R1 goes back.", items: [{ id: "R1", choice: "send_back", note }] });

  const packet = (await coderAttempt(run.id, 4))?.contextPacket as Decided;
  expect(packet.reviewItems?.map((i) => i.id)).toEqual(["R1"]);
  expect(packet.reviewItems?.[0]?.conversation?.at(-1)).toEqual({ author: "krister", body: `Sent back to fix: ${note}` });
  expect(packet.decisions).toEqual([{ gate: "pr", note: expect.stringContaining(note), comments: [] }]);
  expect(packet.decisions?.[0]?.note).toContain("R1");

  // The fix is answered on GitHub and waits for CodeRabbit's next review, as any fix does.
  expect(repliesIn(github).at(-1)?.body.split("\n")[0]).toMatch(/^Valid\. Fixed in /);
  expect((await itemsOf(run.id)).R1).toMatchObject({ state: "awaiting_review", verdict: "fixed" });
  expect((await inspect(db, run.id)).events.find((e) => e.type === "github.item_sent_back")?.payload).toMatchObject({ item: "R1", by: "krister" });
});

test("a fixed summary note that the next summary still lists goes back to the coder once, then a person decides, and Mark done posts nothing", async () => {
  const note = "The changelog omits the date of the release, which the release workflow reads.";
  let fixes = 0;
  const fixing: Answer = (_item, ctx) => ({ verdict: "fixed", evidence: "CHANGELOG.md has the date now.", commit: commitChange(ctx, `Date the release ${++fixes}`) });
  const { github, run, wake, pr, answer } = await opened(withSummary, answeringCoder(fixing));
  const reviewed = () => {
    github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED" });
    github.summaryComment(1, summaryOf(pr().headSha, { note }));
  };
  reviewed();
  await wake();
  expect((await itemsOf(run.id)).R1).toMatchObject({ kind: "summary_note", state: "awaiting_review", verdict: "fixed" });

  // CodeRabbit's summary of the fix still lists the note: it goes back to the coder, saying so.
  reviewed();
  await wake();
  const packet = (await coderAttempt(run.id, 3))?.contextPacket as { reviewItems?: ReviewItem[] };
  expect(packet.reviewItems?.map((i) => i.id)).toEqual(["R1"]);
  expect(packet.reviewItems?.[0]?.conversation).toEqual([{ author: "handoff", body: expect.stringContaining("still lists this") }]);
  expect((await inspect(db, run.id)).events.find((e) => e.type === "github.item_returned")?.payload).toMatchObject({ item: "R1" });

  // The summary of the second fix lists it again: a person decides.
  reviewed();
  await wake();
  expect(await coderAttempt(run.id, 4)).toBeUndefined();
  const [question] = await questionsOf(run.id);
  expect(question?.context).toMatchObject({ items: [expect.objectContaining({ id: "R1", kind: "summary_note", why: "disputed", verdict: "fixed" })] });
  expect((await itemsOf(run.id)).R1).toMatchObject({ state: "disputed", questionId: question!.id });
  expect(github.merged).toEqual([]);

  // Mark done: the note has no thread, so handoff posts nothing on GitHub and only records the person's choice.
  const comments = pr().comments.length;
  await answer({ answer: "Done.", items: [{ id: "R1", choice: "resolve", note: "The release workflow reads the date from the tag." }] });
  expect(pr().comments).toHaveLength(comments);
  expect(pr().reviewThreads).toEqual([]);
  expect((await itemsOf(run.id)).R1).toMatchObject({ state: "resolved", resolvedBy: "krister" });
});

test("an unclear answer is posted to the reviewer first, and a second unclear goes to a person", async () => {
  const unclear: Answer = () => ({ verdict: "unclear", evidence: "Which CI job do you mean: test or e2e?" });
  const { github, run, thread, wake } = await declined(replies, new FakeGitHub(), answeringCoder(unclear));
  expect(repliesIn(github)[0]?.body.split("\n")[0]).toBe("Unclear: Which CI job do you mean: test or e2e?");
  expect(await questionsOf(run.id)).toEqual([]);

  github.replyInThread(1, thread().id!, "coderabbitai", "The test job.");
  await wake();
  const [question] = await questionsOf(run.id);
  expect(question?.context).toMatchObject({ items: [expect.objectContaining({ id: "R1", why: "disputed", verdict: "unclear", reason: "the reviewer answered back, and the comment is still unclear to the coder" })] });
  expect(repliesIn(github)).toHaveLength(2);
});

test("a disputed thread resolved on GitHub while the question waits closes the question, and the run goes on", async () => {
  const { github, run, wake, thread } = await disputed();
  github.resolveThreadAs(1, thread().id!, "krister");
  await wake();

  expect((await itemsOf(run.id)).R1).toMatchObject({ state: "resolved", resolvedBy: "krister" });
  const [question] = await questionsOf(run.id);
  expect(question).toMatchObject({ answeredBy: "handoff", answer: expect.stringContaining("R1") });
  expect((await prStep(run.id, 3))?.status).toBe("passed");
  expect(github.merged).toEqual([1]);
});

test("leave stops handoff from touching the thread", async () => {
  const github = new FakeGitHub();
  github.requireResolvedThreads = true;
  const { run, wake, thread, answer } = await disputed(replies, github);
  await answer({ answer: "leave", option: "leave" });

  expect((await itemsOf(run.id)).R1).toMatchObject({ state: "left", stateReason: "krister chose to leave it" });
  expect((await prStep(run.id, 3))?.status).toBe("passed");
  // The merge waits on the thread, which is the person's to settle on GitHub.
  const merge = (await inspect(db, run.id)).executions.find((e) => e.nodeKey === "merge");
  expect(merge?.status).toBe("waiting");
  const before = repliesIn(github).length;

  // CodeRabbit answers back and reviews again: handoff neither replies nor resolves.
  github.replyInThread(1, thread().id!, "coderabbitai", "Still skipped in CI.");
  github.reviewOnHead(1, "coderabbitai", { state: "APPROVED" });
  await wake();
  expect(repliesIn(github)).toHaveLength(before + 1);
  expect(thread().isResolved).toBe(false);
  expect((await itemsOf(run.id)).R1?.state).toBe("left");
  expect(await coderAttempt(run.id, 4)).toBeUndefined();

  github.resolveThreadAs(1, thread().id!, "krister");
  await wake();
  expect(github.merged).toEqual([1]);
  expect((await itemsOf(run.id)).R1?.state).toBe("left");
});
