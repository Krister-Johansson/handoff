import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CoderOutputSchema, ReviewerOutputSchema, type CoderOutput } from "@handoff/core";
import { prKey, REVIEWER_NOTES_MARKER, toFeedback, type GitHubPort, type RepoRef } from "@handoff/github";
import { and, eq, events, type Db } from "@handoff/db";
import { depsKey, wakeDependents } from "../dependencies.ts";
import { joinQueue, leaveQueue, queueKey, queueTurn } from "../merge-queue.ts";
import type { ExecutorContext, ExecutorOutcome, NodeExecutor } from "../types.ts";
import { externalReview, reviewSettings, withFindings } from "./external-review.ts";

const execFileAsync = promisify(execFile);

const repoOf = (ctx: ExecutorContext): RepoRef => ({ owner: ctx.project.repoOwner, name: ctx.project.repoName });

const flag = (config: Record<string, unknown>, key: string, fallback: boolean) =>
  typeof config[key] === "boolean" ? (config[key] as boolean) : fallback;

/** The latest output of the coder that feeds this PR node, or of any coder in the graph. */
function coderOutput(ctx: ExecutorContext): CoderOutput | undefined {
  const feeding = ctx.graph.inEdges(ctx.node.key).map((e) => e.source);
  const coders = [...feeding, ...ctx.graph.order].filter((key) => ctx.graph.node(key)?.type === "coder");
  for (const key of coders) {
    const parsed = CoderOutputSchema.safeParse(ctx.state.nodes[key]?.output);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

/** The PR text: the coder's own title and description when it wrote them, then the issues it closes. */
function prText(ctx: ExecutorContext): { title: string; body: string } {
  const coder = coderOutput(ctx);
  const lines = [coder?.pr?.body ?? coder?.summary ?? `Task: ${ctx.state.task}`, ""];
  // GitHub closes these issues when the pull request merges into the default branch.
  if (ctx.state.issues?.length) lines.push(...ctx.state.issues.map((i) => `Closes #${i.number}`), "");
  lines.push(`Opened by handoff run \`${ctx.run.id}\`.`);
  return { title: coder?.pr?.title ?? title(ctx.state.task), body: lines.join("\n") };
}

/** The latest comments of every Reviewer node, as one PR comment body, or undefined when there are none. */
export function reviewerNotes(ctx: ExecutorContext): string | undefined {
  const sections: string[] = [];
  for (const key of ctx.graph.order) {
    if (ctx.graph.node(key).type !== "reviewer") continue;
    const parsed = ReviewerOutputSchema.safeParse(ctx.state.nodes[key]?.output);
    if (!parsed.success || parsed.data.comments.length === 0) continue;
    const attempt = ctx.state.nodes[key]?.attempt;
    sections.push(
      `**${ctx.graph.node(key).label}**${attempt ? ` (attempt ${attempt})` : ""}: ${parsed.data.verdict === "approve" ? "approved" : "requested changes"}`,
      "",
      ...parsed.data.comments.map((c) => `- \`${c.line !== undefined ? `${c.path}:${c.line}` : c.path}\` ${c.body.replace(/\n+/g, " ")}`),
      "",
    );
  }
  if (sections.length === 0) return undefined;
  return [REVIEWER_NOTES_MARKER, "### Reviewer notes", "", ...sections, `Posted by handoff run \`${ctx.run.id}\`. Updated on each attempt.`].join("\n");
}

type Sync = { status: "up_to_date" | "merged"; baseSha: string } | { status: "conflict"; baseSha: string; files: string[] };

/**
 * Brings the run's branch up to date with the base branch before it is pushed: fetches the base and
 * merges it in when the branch is behind. On a conflict the merge is undone, the worktree stays as the
 * coder left it, and the conflicting files are reported. The merge commit uses the machine's git
 * identity, or handoff's when none is set.
 */
async function syncWithBase(cwd: string, base: string, env: NodeJS.ProcessEnv): Promise<Sync> {
  const run = async (args: string[]) => (await execFileAsync("git", args, { cwd, env })).stdout.trim();
  await run(["fetch", "-q", "origin", base]);
  const baseSha = await run(["rev-parse", "FETCH_HEAD"]);
  const behind = await run(["merge-base", "--is-ancestor", baseSha, "HEAD"]).then(
    () => false,
    () => true,
  );
  if (!behind) return { status: "up_to_date", baseSha };
  const identity = (await run(["config", "user.email"]).catch(() => "")) ? [] : ["-c", "user.name=handoff", "-c", "user.email=handoff@localhost"];
  try {
    await run([...identity, "merge", "--no-edit", "-m", `Merge ${base} into this branch`, baseSha]);
    return { status: "merged", baseSha };
  } catch {
    const files = (await run(["diff", "--name-only", "--diff-filter=U"]).catch(() => "")).split("\n").filter(Boolean);
    await run(["merge", "--abort"]).catch(() => undefined);
    return { status: "conflict", baseSha, files };
  }
}

/** Whether the graph sends this node's `port` output anywhere. */
const routes = (ctx: ExecutorContext, port: string) => ctx.graph.outEdges(ctx.node.key).some((e) => e.port === port);

const title = (task: string) => (task.length > 72 ? `${task.slice(0, 69)}...` : task);

/**
 * Pushes the run branch, opens or reuses its pull request, then reports CI and review state as
 * feedback. Waits (without holding a process) while checks are pending, or while an approval is
 * required and missing. Routing on the output decides between merge and a loop back to the Coder.
 */
export function prNodeExecutor(deps: { github: GitHubPort; reconcileMs?: number; db?: Db }): NodeExecutor {
  return {
    needsWorkdir: true,
    async execute(ctx): Promise<ExecutorOutcome> {
      const repo = repoOf(ctx);
      const requireChecks = flag(ctx.node.config, "requireChecks", true);
      const requireApproval = flag(ctx.node.config, "requireApproval", false);

      const pushing = !ctx.execution.wakeReason;
      if (pushing) {
        if (!ctx.workdir) return { kind: "failed", error: { code: "no_workdir", message: "PR node needs the run worktree to push" } };
        const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", ...(await deps.github.gitAuthEnv(repo)) };
        // Main may have moved since the run branched off it: catch up first, so the pull request is not born behind or in conflict.
        const sync = await syncWithBase(ctx.workdir.path, ctx.run.baseBranch, env);
        if (sync.status === "conflict") {
          ctx.emit("github.conflict", { base: ctx.run.baseBranch, baseSha: sync.baseSha, files: sync.files });
          if (!routes(ctx, "fix")) {
            return { kind: "failed", error: { code: "merge_conflict", message: `${ctx.run.baseBranch} changed the same lines as this run in ${sync.files.join(", ")}` } };
          }
          // Going back to resolve: give up the place in the merge queue so the next pull request can land.
          if (deps.db) await leaveQueue(deps.db, ctx.run.id, ctx.project.id);
          return { kind: "completed", output: { sync: "conflict", conflict: { base: ctx.run.baseBranch, baseSha: sync.baseSha, files: sync.files } } };
        }
        ctx.emit("github.synced", { base: ctx.run.baseBranch, baseSha: sync.baseSha, merged: sync.status === "merged" });
        await execFileAsync("git", ["push", "--force-with-lease", "-u", "origin", `HEAD:refs/heads/${ctx.run.branchName}`], { cwd: ctx.workdir.path, env });
      }

      let number = ctx.state.prNumber;
      if (number === undefined) {
        const pr = (await deps.github.findPrByHead(repo, ctx.run.branchName)) ?? (await deps.github.createPr(repo, { head: ctx.run.branchName, base: ctx.run.baseBranch, ...prText(ctx) }));
        number = pr.number;
        await ctx.recordPrNumber(number);
      } else if (pushing && coderOutput(ctx)?.pr) {
        // A later round rewrote the description of the change; the pull request follows it.
        await deps.github.updatePr(repo, number, prText(ctx));
      }
      let repoId = ctx.project.repoId;
      if (repoId === null) {
        repoId = await deps.github.getRepoId(repo);
        await ctx.recordRepoId(repoId);
      }
      const key = prKey(repoId, number);
      await ctx.registerWait(key);

      const notes = pushing ? reviewerNotes(ctx) : undefined;
      if (notes) {
        const { created } = await deps.github.upsertPrComment(repo, number, REVIEWER_NOTES_MARKER, notes);
        ctx.emit("github.reviewer_notes", { number, created });
      }

      const snapshot = await deps.github.getPrSnapshot(repo, number);
      if (snapshot.state === "closed") return { kind: "failed", error: { code: "pr_closed", message: `PR #${number} was closed without merging` } };

      const failedJobs = (snapshot.checks?.contexts ?? []).filter((c) => c.checkRunId !== undefined && c.conclusion === "FAILURE");
      const logs = await Promise.all(
        failedJobs.map(async (c) => ({ jobId: c.checkRunId!, log: (await deps.github.getJobLogTail(repo, c.checkRunId!)) ?? "" })),
      );
      let feedback = toFeedback(snapshot, logs);
      // A repository without CI never gets a check; after a while, stop waiting for one and treat CI as passed.
      const sincePush = Date.now() - (ctx.execution.startedAt ?? new Date()).getTime();
      const noChecksMs = (typeof ctx.node.config.noChecksAfterMinutes === "number" ? ctx.node.config.noChecksAfterMinutes : 10) * 60_000;
      const noChecks = requireChecks && snapshot.checks === null && snapshot.state === "open";
      // A repository with no workflows and no required checks will never get one: there is nothing to wait for.
      const noCi = noChecks && !(await deps.github.expectsChecks(repo, ctx.run.baseBranch).catch(() => true));
      if (noChecks && (noCi || sincePush >= noChecksMs)) {
        ctx.emit("github.no_checks", noCi ? { number, reason: "no_ci" } : { number, afterMinutes: noChecksMs / 60_000 });
        feedback = { ...feedback, ci: { ...feedback.ci, status: "success" } };
      }
      ctx.emit("github.pr", { number, url: snapshot.url, headSha: snapshot.headSha, ci: feedback.ci.status, review: feedback.review.decision });

      const checksPending = requireChecks && feedback.ci.status === "pending" && snapshot.state === "open";
      const awaitingApproval =
        requireApproval && feedback.review.decision === "none" && feedback.ci.status !== "failure" && snapshot.state === "open";

      // External reviewers (review bots such as CodeRabbit or Copilot, or people) on the head commit.
      const settings = reviewSettings(ctx.node.config);
      const handled = new Set(Array.isArray(ctx.state.prHandledReviews) ? ctx.state.prHandledReviews.map(String) : []);
      const waitingForMs = sincePush;
      const external = externalReview(snapshot, settings, handled, waitingForMs);
      const awaitingReviewers = external.missing.length > 0 && !external.timedOut && feedback.ci.status !== "failure" && snapshot.state === "open";
      if (external.missing.length) ctx.emit("github.reviewers", { number, waitingFor: external.missing, timedOut: external.timedOut });
      if (external.timedOut) ctx.emit("github.reviewers_timeout", { number, missing: external.missing });

      if (checksPending || awaitingApproval || awaitingReviewers) {
        // Also wake when a PR without checks reaches its limit, so a repository without CI does not wait for the reconcile.
        const reconcile = Math.min(Date.now() + (deps.reconcileMs ?? 10 * 60_000), noChecks ? Date.now() + Math.max(0, noChecksMs - sincePush) + 1_000 : Infinity);
        // Wake at the review time limit even without a webhook, so a reviewer who never comes cannot hold the run.
        const limit = awaitingReviewers ? Date.now() + Math.max(0, settings.timeoutMs - waitingForMs) + 1_000 : reconcile;
        return { kind: "waiting", wait: { kind: "github_pr", key, deadlineAt: new Date(Math.min(reconcile, limit)) } };
      }

      const sendBack = settings.sendBack && external.findings.length > 0;
      const routed = sendBack ? withFindings(feedback, external.findings) : feedback;
      if (sendBack) ctx.emit("github.review_findings", { number, findings: external.findings.length });
      // Going back to fix CI or review: give up the place in the merge queue.
      if (deps.db && (routed.ci.status === "failure" || routed.review.decision === "changes_requested")) await leaveQueue(deps.db, ctx.run.id, ctx.project.id);
      const output = { sync: "clean", prNumber: number, prUrl: snapshot.url, headSha: snapshot.headSha, feedback: routed };
      const statePatch: Record<string, unknown> = { prNumber: number, feedback: routed };
      if (sendBack) statePatch.prHandledReviews = [...handled, ...external.findings.map((f) => f.id)];
      return { kind: "completed", output, statePatch };
    },
  };
}

/**
 * Closes the run's linked issues that are still open once its pull request merged. The PR body's
 * "Closes #N" is not always honoured by GitHub (a real run merged without closing its issue), so the
 * engine closes them itself. A failure here is reported as an event and does not fail the merge.
 */
async function closeLinkedIssues(github: GitHubPort, ctx: ExecutorContext, repo: RepoRef, prNumber: number) {
  const issues = ctx.state.issues ?? [];
  if (issues.length === 0) return;
  const closed: number[] = [];
  for (const issue of issues) {
    try {
      if ((await github.getIssue(repo, issue.number)).state !== "open") continue;
      await github.closeIssue(repo, issue.number, `Fixed by #${prNumber}, merged by handoff run \`${ctx.run.id}\`.`);
      closed.push(issue.number);
    } catch (error) {
      ctx.emit("github.issue_close_failed", { number: issue.number, message: (error as Error).message });
    }
  }
  if (closed.length) ctx.emit("github.issues_closed", { numbers: closed });
}

/** Whether this execution already recorded an event of this type, across its waits. */
async function emittedBefore(db: Db, executionId: string, type: string) {
  const [row] = await db.select({ id: events.id }).from(events).where(and(eq(events.nodeExecutionId, executionId), eq(events.type, type))).limit(1);
  return row !== undefined;
}

/** The run's issues that GitHub records as blocked by open issues, with their blockers. */
async function blockedIssues(github: GitHubPort, repo: RepoRef, issues: { number: number }[]) {
  const all = await Promise.all(issues.map(async (i) => ({ issue: i.number, blockedBy: await github.openBlockers(repo, i.number) })));
  return all.filter((b) => b.blockedBy.length > 0);
}

/** How long a blocked pull request waits before it asks GitHub again, should a wake be missed. */
const BLOCKED_RECHECK_MS = 5 * 60_000;

/** How long a run in the merge queue waits before it checks its turn again, should a wake be missed. */
const QUEUE_RECHECK_MS = 60_000;

/**
 * Merges the run's pull request (squash by default). With the database, it first takes its place in
 * the project's merge queue and waits for its turn: first in line, and, unless the node's mode is
 * auto, asked to merge by a person. At its turn a pull request that conflicts with the base branch or
 * is behind it goes back on the update edge to catch up, keeping its place. Merging wakes the queue.
 */
export function mergeNodeExecutor(deps: { github: GitHubPort; db?: Db }): NodeExecutor {
  return {
    needsWorkdir: false,
    async execute(ctx): Promise<ExecutorOutcome> {
      const number = ctx.state.prNumber;
      if (number === undefined) return { kind: "failed", error: { code: "no_pr", message: "no pull request recorded in run state" } };
      const repo = repoOf(ctx);
      const { db } = deps;
      if (db) {
        const mode = ctx.node.config.mode === "auto" ? "auto" : "manual";
        // An issue GitHub records as blocked by an open issue keeps the pull request out of the queue until that closes.
        const blocked = await blockedIssues(deps.github, repo, ctx.state.issues ?? []);
        if (blocked.length) {
          // Only a run that had a place gives it up; leaving wakes every run in the queue.
          if (ctx.run.mergeQueuedAt) await leaveQueue(db, ctx.run.id, ctx.project.id);
          if (ctx.execution.wakeReason !== "timeout") for (const b of blocked) ctx.emit("merge.blocked", b);
          const key = depsKey(ctx.project.id);
          await ctx.registerWait(key);
          return { kind: "waiting", wait: { kind: "timer", key, deadlineAt: new Date(Date.now() + BLOCKED_RECHECK_MS) } };
        }
        await joinQueue(db, ctx.run.id);
        const turn = await queueTurn(db, ctx.run.id, ctx.project.id);
        if (turn.position > 1 || (mode === "manual" && !turn.requested)) {
          // Only on news, not on every periodic recheck.
          if (ctx.execution.wakeReason !== "timeout") ctx.emit("merge.queued", { number, position: turn.position, mode, requested: turn.requested });
          // First in line and waiting for a person: say so once, so the dashboard can tell them.
          if (turn.position === 1 && mode === "manual" && !turn.requested && !(await emittedBefore(db, ctx.execution.id, "merge.ready"))) {
            ctx.emit("merge.ready", { number });
          }
          const key = queueKey(ctx.project.id);
          await ctx.registerWait(key);
          return { kind: "waiting", wait: { kind: "merge_queue", key, deadlineAt: new Date(Date.now() + QUEUE_RECHECK_MS) } };
        }
      }
      const done = async (outcome: ExecutorOutcome) => {
        if (db) await leaveQueue(db, ctx.run.id, ctx.project.id);
        return outcome;
      };
      const snapshot = await deps.github.getPrSnapshot(repo, number);
      if (snapshot.merged) return done({ kind: "completed", output: { merged: true } });
      // Main moved under the pull request: send it back to catch up, keeping its place in the queue.
      const catchUp = (why: string) =>
        routes(ctx, "update")
          ? ({ kind: "completed", output: { merged: false, needsUpdate: true } } as const)
          : ({ kind: "failed", error: { code: "merge_conflict", message: `PR #${number} ${why} ${ctx.run.baseBranch}; add an update edge from this node back to the PR node to catch up` } } as const);
      if (snapshot.mergeable === "CONFLICTING") return catchUp("conflicts with");
      // Behind but clean would merge, untested against what landed since: catch up first when the graph can.
      if (routes(ctx, "update") && (await deps.github.behindBy(repo, ctx.run.baseBranch, snapshot.headSha)) > 0) {
        ctx.emit("merge.behind", { number, base: ctx.run.baseBranch });
        return catchUp("is behind");
      }
      const method = ctx.node.config.method === "merge" || ctx.node.config.method === "rebase" ? ctx.node.config.method : "squash";
      try {
        const result = await deps.github.mergePr(repo, number, method);
        if (!result.merged) return done({ kind: "failed", error: { code: "merge_failed", message: `GitHub did not merge PR #${number}` } });
        ctx.emit("github.merged", { number, sha: result.sha });
        await closeLinkedIssues(deps.github, ctx, repo, number);
        // Closed issues may unblock other runs of the project waiting at their Start.
        if (db) await wakeDependents(db, ctx.project.id);
        return done({ kind: "completed", output: { merged: true, ...(result.sha ? { sha: result.sha } : {}) } });
      } catch (error) {
        return done({ kind: "failed", error: { code: "merge_failed", message: (error as Error).message } });
      }
    },
  };
}
