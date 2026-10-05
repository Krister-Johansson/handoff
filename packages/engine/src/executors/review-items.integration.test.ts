import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import type { ReviewAnswer, ReviewItem } from "@handoff/core";
import { wakeByKey } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import type { RepoRef } from "@handoff/github";
import { FakeGitHub } from "@handoff/github/testing";
import { createRun } from "../runs.ts";
import { createOriginRepo, git } from "../testing/git.ts";
import { drain, engineDeps, inspect, seedGraph } from "../testing/harness.ts";
import { done, outputs, scripted } from "../testing/scripted.ts";
import type { ExecutorContext, NodeExecutor } from "../types.ts";
import { GitWorktreeProvider } from "../workdir/git-worktree.ts";
import { withReviewAnswers } from "./cli-node.ts";
import { mergeNodeExecutor, prNodeExecutor } from "./github.ts";

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

/** The steps between the coder and the PR node in a guided graph, each passing. */
const checkers = {
  tester: scripted(done(outputs.testsPass)),
  code_review: scripted(done(outputs.approve)),
  human_gate: scripted(done({ option: "approve", answer: "Approve", answeredBy: "dashboard", answeredAt: "2026-10-05T00:00:00Z" })),
  demo: scripted(done({ summary: "Skipped", skipped: true, reason: "the change touches no UI path", shots: [] })),
};

/**
 * A graph like northMES's guided one: the coder's work goes through the tester, code review, a code gate
 * and a demo that is skipped without UI changes, then to the PR node, which joins the demo's skipped port
 * and the Try it gate's approve. Each of them can send the work back to the coder.
 */
const guided = (prConfig: Record<string, unknown>) => ({
  attributes: { startNode: "planner" },
  nodes: [
    { key: "planner", attributes: { type: "planner", x: 0, y: 0 } },
    { key: "coder", attributes: { type: "coder", x: 0, y: 0 } },
    { key: "tester", attributes: { type: "tester", config: { command: "pnpm test" }, x: 0, y: 0 } },
    { key: "code-review", attributes: { type: "code_review", x: 0, y: 0 } },
    { key: "code-gate", attributes: { type: "human_gate", x: 0, y: 0 } },
    { key: "demo", attributes: { type: "demo", config: { when: "ui_changes" }, x: 0, y: 0 } },
    { key: "try", attributes: { type: "human_gate", config: { mode: "try" }, x: 0, y: 0 } },
    { key: "pr", attributes: { type: "pr", config: { join: "any", ...prConfig }, x: 0, y: 0 } },
    { key: "merge", attributes: { type: "merge", x: 0, y: 0 } },
  ],
  edges: [
    { key: "planner->coder", source: "planner", target: "coder", attributes: { port: "done" } },
    { key: "coder->tester", source: "coder", target: "tester", attributes: { port: "done" } },
    { key: "tester->code-review", source: "tester", target: "code-review", attributes: { port: "pass" } },
    { key: "tester->coder", source: "tester", target: "coder", attributes: { port: "fail", input: "feedback" } },
    { key: "code-review->code-gate", source: "code-review", target: "code-gate", attributes: { port: "approve" } },
    { key: "code-review->coder", source: "code-review", target: "coder", attributes: { port: "changes", input: "feedback" } },
    { key: "code-gate->demo", source: "code-gate", target: "demo", attributes: { port: "approve" } },
    { key: "code-gate->coder", source: "code-gate", target: "coder", attributes: { port: "changes", input: "feedback" } },
    { key: "demo->pr", source: "demo", target: "pr", attributes: { port: "skipped" } },
    { key: "demo->try", source: "demo", target: "try", attributes: { port: "done" } },
    { key: "try->pr", source: "try", target: "pr", attributes: { port: "approve" } },
    { key: "try->coder", source: "try", target: "coder", attributes: { port: "changes", input: "feedback" } },
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
 * packet with `answer`. Its answers go to run state, and `answerOnly` is set, as the coder executor does.
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
      const { output, reviewAnswers } = await withReviewAnswers(ctx, { status: "done", summary: "Answered the review comments", answers });
      return { kind: "completed", output, ...(reviewAnswers ? { statePatch: { reviewAnswers } } : {}) };
    },
  };
}

/** A run whose PR node waits for CI; CI then passes, and `wake` lets the PR node look again. */
async function opened(prConfig: Record<string, unknown>, coder: NodeExecutor, github = new FakeGitHub(), prExecutor?: NodeExecutor, document = graph) {
  const origin = createOriginRepo();
  github.origin = origin;
  const { project, graphVersion } = await seedGraph(db, document(prConfig), { localClonePath: origin });
  const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Add a CHANGELOG.md" });
  const workdirs = new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) });
  // A fresh PR executor for each pass, as a restarted worker would have.
  const deps = () => engineDeps(db, { planner, coder, pr: prExecutor ?? prNodeExecutor({ github, db }), merge: mergeNodeExecutor({ github }), ...checkers }, { workdirs });
  await drain(deps());
  github.setChecks(1, "SUCCESS");
  const wake = async () => {
    await wakeByKey(db, "gh:pr:42:1", { reason: "webhook" });
    await drain(deps());
  };
  const pr = () => github.prs.get(1)!;
  return { origin, github, run, wake, pr };
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

/** How many times each step between the coder and the PR node ran. */
async function checkerRuns(runId: string) {
  const { executions } = await inspect(db, runId);
  return Object.fromEntries(["tester", "code-review", "code-gate", "demo"].map((key) => [key, executions.filter((e) => e.nodeKey === key).length]));
}

const once = { tester: 1, "code-review": 1, "code-gate": 1, demo: 1 };
const twice = { tester: 2, "code-review": 2, "code-gate": 2, demo: 2 };

test("a round where the coder declines every comment and commits nothing goes back to the PR node with no tester, code review, gate or demo execution", async () => {
  const { github, run, wake } = await opened(replies, answeringCoder(decline), new FakeGitHub(), undefined, guided);
  github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED", threads: [{ path: "vitest.config.ts", line: 12, body: "The integration project never runs in CI." }] });
  await wake();

  const { executions, events, run: row } = await inspect(db, run.id);
  expect(executions.filter((e) => e.nodeKey === "coder").map((e) => e.attempt)).toEqual([1, 2]);
  expect(await checkerRuns(run.id)).toEqual(once);
  const coder = executions.find((e) => e.nodeKey === "coder" && e.attempt === 2)!;
  const back = executions.find((e) => e.nodeKey === "pr" && e.attempt === 2);
  expect(back?.trigger).toEqual({ kind: "returned", from: "coder", fromExecutionId: coder.id });
  expect(events.find((e) => e.type === "edge.returned")).toMatchObject({
    nodeExecutionId: coder.id,
    payload: { from: "coder", to: "pr", edgeKey: "pr->coder", message: "answered review comments only; back to pr" },
  });
  // The fix edge counted the round once, when it sent the work to the coder; the return adds nothing, and no join was reached.
  expect(row.state).toMatchObject({ loops: { "pr->coder": { attempts: 1 } } });
  expect(events.filter((e) => e.type === "join.arrived")).toHaveLength(1);
  expect(repliesIn(github)).toHaveLength(1);
});

/** A fixed answer with the commit the coder made for it. */
const fixing: Answer = (_item, ctx) => ({
  verdict: "fixed",
  evidence: "vitest.config.ts:12 left the integration project out of the CI run; it is in now.",
  commit: commitChange(ctx, "Run the integration project in CI"),
});

test("a round with a fix goes through the tester and code review", async () => {
  const { github, run, wake } = await opened(replies, answeringCoder(fixing), new FakeGitHub(), undefined, guided);
  github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED", threads: [{ path: "vitest.config.ts", line: 12, body: "The integration project never runs in CI." }] });
  await wake();

  const { executions, types } = await inspect(db, run.id);
  expect(await checkerRuns(run.id)).toEqual(twice);
  expect(types).not.toContain("edge.returned");
  const back = executions.find((e) => e.nodeKey === "pr" && e.attempt === 2);
  expect(back?.trigger).toMatchObject({ kind: "edge", edgeKey: "demo->pr", from: "demo" });
  expect(repliesIn(github)[0]?.body.split("\n")[0]).toMatch(/^Valid\. Fixed in /);
});

test("a mixed round takes the normal path and posts both answers", async () => {
  const answer: Answer = (item, ctx) => (item.path === "vitest.config.ts" ? fixing(item, ctx) : decline(item, ctx));
  const { github, run, wake } = await opened(replies, answeringCoder(answer), new FakeGitHub(), undefined, guided);
  github.reviewOnHead(1, "coderabbitai", {
    state: "COMMENTED",
    threads: [
      { path: "vitest.config.ts", line: 12, body: "The integration project never runs in CI." },
      { path: "CHANGELOG.md", line: 1, body: "The heading level is inconsistent." },
    ],
  });
  await wake();

  expect(await checkerRuns(run.id)).toEqual(twice);
  expect((await inspect(db, run.id)).types).not.toContain("edge.returned");
  const firstLines = github.prs.get(1)!.reviewThreads.map((t) => t.comments.slice(1).map((c) => c.body.split("\n")[0]));
  expect(firstLines).toEqual([[expect.stringMatching(/^Valid\. Fixed in /)], ["Not changed: the comment does not hold."]]);
});

test("the 33311b09 case: a declined CodeRabbit comment reaches the coder once, and the PR step then waits for CodeRabbit instead of going round again", async () => {
  const { github, run, wake, pr } = await opened(replies, answeringCoder(decline), new FakeGitHub(), undefined, guided);
  // As on northMES/northmes#192: CodeRabbit asks for changes on the head with one thread, and GitHub reports
  // its decision (whether a bot's review sets reviewDecision is unverified; this takes the case where it does).
  github.reviewOnHead(1, "coderabbitai", { state: "CHANGES_REQUESTED", threads: [{ path: "vitest.config.ts", line: 12, body: "The integration project never runs in CI." }] });
  pr().reviewDecision = "CHANGES_REQUESTED";
  await wake();

  // The coder declined it once and committed nothing: straight back to the PR step, which answered in the thread.
  let seen = await inspect(db, run.id);
  expect(seen.executions.filter((e) => e.nodeKey === "coder").map((e) => e.attempt)).toEqual([1, 2]);
  expect(await checkerRuns(run.id)).toEqual(once);
  expect(repliesIn(github)).toHaveLength(1);
  // GitHub still reports the old decision, and the step waits for CodeRabbit's next review instead of routing it to fix.
  const back = () => seen.executions.find((e) => e.nodeKey === "pr" && e.attempt === 2);
  expect(back()?.status).toBe("waiting");
  expect(seen.events.filter((e) => e.type === "github.rereview").at(-1)?.payload).toMatchObject({ waitingFor: ["coderabbitai"], items: ["R1"], timedOut: false });

  // The reply's own webhook wakes the step; CodeRabbit has not reviewed since, so it keeps waiting.
  await wake();
  seen = await inspect(db, run.id);
  expect(back()?.status).toBe("waiting");
  expect(seen.executions.filter((e) => e.nodeKey === "coder")).toHaveLength(2);

  // Eight seconds after the reply CodeRabbit approves the same commit, and the run goes on to merge.
  github.reviewOnHead(1, "coderabbitai", { state: "APPROVED" });
  pr().reviewDecision = "APPROVED";
  await wake();
  seen = await inspect(db, run.id);
  expect(seen.executions.filter((e) => e.nodeKey === "coder")).toHaveLength(2);
  expect(seen.executions.filter((e) => e.nodeKey === "pr").map((e) => e.status)).toEqual(["passed", "passed"]);
  expect(seen.events.filter((e) => e.type === "github.review_findings").map((e) => e.payload)).toEqual([expect.objectContaining({ items: ["R1"] })]);
  expect(github.merged).toEqual([1]);
  // Step 5 alone leaves the thread open: resolving it after CodeRabbit's review is step 6, and until then a ruleset
  // that requires resolved conversations holds the merge step. Had CodeRabbit only commented, GitHub would still
  // report CHANGES_REQUESTED after the wait, and step 5 alone would send the round to fix with no item to answer;
  // step 6 keeps that old decision from routing to fix.
  expect(pr().reviewThreads[0]!.isResolved).toBe(false);
});

test("with returnOnAnswerOnly false the round takes the normal path", async () => {
  const settings = { ...replies, reviewThreads: { reply: true, returnOnAnswerOnly: false } };
  const { github, run, wake } = await opened(settings, answeringCoder(decline), new FakeGitHub(), undefined, guided);
  github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED", threads: [{ path: "vitest.config.ts", line: 12, body: "The integration project never runs in CI." }] });
  await wake();

  const { executions, types } = await inspect(db, run.id);
  // The coder still only answered; the setting alone sends the round through the steps in between.
  expect(executions.find((e) => e.nodeKey === "coder" && e.attempt === 2)?.output).toMatchObject({ answerOnly: true });
  expect(await checkerRuns(run.id)).toEqual(twice);
  expect(types).not.toContain("edge.returned");
  expect(executions.find((e) => e.nodeKey === "pr" && e.attempt === 2)?.trigger).toMatchObject({ kind: "edge", edgeKey: "demo->pr" });
  expect(repliesIn(github)).toHaveLength(1);
});
