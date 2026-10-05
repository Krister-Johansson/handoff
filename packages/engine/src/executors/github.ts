import { execFile } from "node:child_process";
import { rmSync } from "node:fs";
import { basename } from "node:path";
import { promisify } from "node:util";
import { brief, CoderOutputSchema, ReviewerOutputSchema, runPath, type CoderOutput } from "@handoff/core";
import { prKey, REVIEWER_NOTES_MARKER, toFeedback, type GitHubPort, type PlanStatus, type ProjectsPort, type RepoRef } from "@handoff/github";
import { and, asc, desc, eq, events, screenshots, sql, webhookDeliveries, type Db } from "@handoff/db";
import { nudgeScheduler, wakeOverlapHeld } from "../backlog-scheduler/nudge.ts";
import { depsKey, wakeDependents } from "../dependencies.ts";
import { joinQueue, leaveQueue, queueKey, queueTurn } from "../merge-queue.ts";
import { writePlanStatus } from "../plan-status.ts";
import type { ExecutorContext, ExecutorOutcome, NodeExecutor } from "../types.ts";
import { withNetworkRetry } from "../workdir/network.ts";
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

/** The branch handoff keeps screenshots on, apart from the code, so pull requests can show them. */
export const ASSETS_BRANCH = "handoff-assets";

/** A screenshot on the assets branch: where it is under runs/<run>/, and what it shows. */
type PrShot = { name: string; caption: string; criterion: string | null; works: boolean | null };

/** The screenshots of the run's latest Demo step, in the order it took them. */
async function latestScreenshots(db: Db, runId: string) {
  const rows = await db.select().from(screenshots).where(eq(screenshots.runId, runId)).orderBy(desc(screenshots.createdAt), asc(screenshots.position));
  const latest = rows[0]?.nodeExecutionId;
  return rows.filter((r) => r.nodeExecutionId === latest).sort((a, b) => a.position - b.position);
}

/**
 * Commits screenshots to the repository's assets branch under runs/<run>/, keeping what earlier runs
 * put there, and pushes it. Git plumbing with a separate index builds the commit, so the run's worktree
 * and branch are untouched. A push that loses a race with another run is tried once more.
 */
async function pushScreenshots(cwd: string, env: NodeJS.ProcessEnv, runId: string, files: string[]): Promise<string[]> {
  const git = async (args: string[], extra: Record<string, string> = {}) => (await execFileAsync("git", args, { cwd, env: { ...env, ...extra } })).stdout.trim();
  const index = await git(["rev-parse", "--git-path", "handoff-assets-index"]);
  const identity = (await git(["config", "user.email"]).catch(() => ""))
    ? {}
    : { GIT_AUTHOR_NAME: "handoff", GIT_AUTHOR_EMAIL: "handoff@localhost", GIT_COMMITTER_NAME: "handoff", GIT_COMMITTER_EMAIL: "handoff@localhost" };
  for (let attempt = 1; ; attempt++) {
    const parent = await git(["fetch", "-q", "origin", `refs/heads/${ASSETS_BRANCH}`])
      .then(() => git(["rev-parse", "FETCH_HEAD"]))
      .catch(() => undefined);
    rmSync(index, { force: true });
    const separate = { GIT_INDEX_FILE: index };
    await git(parent ? ["read-tree", parent] : ["read-tree", "--empty"], separate);
    const names: string[] = [];
    for (const file of files) {
      const name = basename(file);
      const blob = await git(["hash-object", "-w", file]);
      await git(["update-index", "--add", "--cacheinfo", `100644,${blob},runs/${runId}/${name}`], separate);
      names.push(name);
    }
    const tree = await git(["write-tree"], separate);
    rmSync(index, { force: true });
    const commit = await git(["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", `Screenshots for handoff run ${runId}`], identity);
    try {
      await git(["push", "-q", "origin", `${commit}:refs/heads/${ASSETS_BRANCH}`]);
      return names;
    } catch (error) {
      if (attempt >= 2) throw error;
    }
  }
}

/** The PR's Screenshots section: each image from the assets branch, its caption, and whether its criterion works. */
function screenshotsSection(repo: RepoRef, runId: string, shots: PrShot[]): string[] {
  if (shots.length === 0) return [];
  const lines = ["## Screenshots", ""];
  for (const shot of shots) {
    const url = `https://github.com/${repo.owner}/${repo.name}/blob/${ASSETS_BRANCH}/runs/${runId}/${shot.name}?raw=true`;
    lines.push(`![${shot.caption}](${url})`, "", `*${shot.caption}*`);
    if (shot.criterion) lines.push("", `${shot.criterion}: ${shot.works === false ? "does not work" : "works"}`);
    lines.push("");
  }
  return lines;
}

/** The PR text: the coder's own title and description when it wrote them, the demo's screenshots, then the issues it closes. */
function prText(ctx: ExecutorContext, shots: PrShot[] = []): { title: string; body: string } {
  const coder = coderOutput(ctx);
  const lines = [coder?.pr?.body ?? coder?.summary ?? `Task: ${ctx.state.task}`, "", ...screenshotsSection(repoOf(ctx), ctx.run.id, shots)];
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
async function syncWithBase(cwd: string, base: string, env: NodeJS.ProcessEnv, retryMs?: number): Promise<Sync> {
  const run = async (args: string[]) => (await execFileAsync("git", args, { cwd, env })).stdout.trim();
  await withNetworkRetry(() => run(["fetch", "-q", "origin", base]), retryMs);
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

/** Sets the run's linked tasks to `status` on the plan and records what happened; never throws. */
async function movePlan(projects: ProjectsPort | undefined, ctx: ExecutorContext, status: PlanStatus) {
  const written = await writePlanStatus(projects, ctx.project, (ctx.state.issues ?? []).map((i) => i.number), status);
  for (const event of written) ctx.emit(event.type, event.payload);
}

/** Whether the graph sends this node's `port` output anywhere. */
const routes = (ctx: ExecutorContext, port: string) => ctx.graph.outEdges(ctx.node.key).some((e) => e.port === port);

const title = (task: string) => (task.length > 72 ? `${task.slice(0, 69)}...` : task);

/**
 * Whether a webhook delivery from the repository arrived since the step started. Without the database
 * the executor cannot tell, and trusts webhooks to wake it.
 */
async function webhooksSince(db: Db | undefined, repoId: number, executionId: string): Promise<boolean> {
  if (!db) return true;
  // Compared in SQL: a JavaScript Date drops the microseconds Postgres keeps.
  const started = sql`(select started_at from node_executions where id = ${executionId})`;
  const [heard] = await db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.repoId, repoId), sql`${webhookDeliveries.receivedAt} >= ${started}`))
    .limit(1);
  return heard !== undefined;
}

/**
 * Pushes the run branch, opens or reuses its pull request, then reports CI and review state as
 * feedback. Waits (without holding a process) while checks are pending, or while an approval is
 * required and missing. Routing on the output decides between merge and a loop back to the Coder.
 */
export function prNodeExecutor(deps: {
  github: GitHubPort;
  reconcileMs?: number;
  db?: Db;
  projects?: ProjectsPort | undefined;
  /** The first wait before a failed fetch or push is tried again; tests shorten it. */
  gitRetryMs?: number;
  /** How soon a PR waiting on GitHub looks again while no webhook has come from its repository since the push. Default one minute. */
  noWebhookPollMs?: number;
}): NodeExecutor {
  return {
    needsWorkdir: true,
    async execute(ctx): Promise<ExecutorOutcome> {
      const repo = repoOf(ctx);
      const requireChecks = flag(ctx.node.config, "requireChecks", true);
      const requireApproval = flag(ctx.node.config, "requireApproval", false);

      const pushing = !ctx.execution.wakeReason;
      let shots: PrShot[] = [];
      if (pushing) {
        if (!ctx.workdir) return { kind: "failed", error: { code: "no_workdir", message: "PR node needs the run worktree to push" } };
        const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", ...(await deps.github.gitAuthEnv(repo)) };
        // Main may have moved since the run branched off it: catch up first, so the pull request is not born behind or in conflict.
        const sync = await syncWithBase(ctx.workdir.path, ctx.run.baseBranch, env, deps.gitRetryMs);
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
        const cwd = ctx.workdir.path;
        await withNetworkRetry(() => execFileAsync("git", ["push", "--force-with-lease", "-u", "origin", `HEAD:refs/heads/${ctx.run.branchName}`], { cwd, env }), deps.gitRetryMs);
        // A Demo step's screenshots go to the assets branch so the description can show them; failing that, the PR opens without them.
        const taken = deps.db ? await latestScreenshots(deps.db, ctx.run.id) : [];
        if (taken.length) {
          try {
            const names = await pushScreenshots(ctx.workdir.path, env, ctx.run.id, taken.map((t) => t.path));
            shots = taken.map((t, i) => ({ name: names[i]!, caption: t.caption, criterion: t.criterion, works: t.works }));
            ctx.emit("github.screenshots", { branch: ASSETS_BRANCH, count: shots.length });
          } catch (error) {
            ctx.emit("github.screenshots_failed", { message: (error as Error).message });
          }
        }
      }

      let number = ctx.state.prNumber;
      if (number === undefined) {
        const pr = (await deps.github.findPrByHead(repo, ctx.run.branchName)) ?? (await deps.github.createPr(repo, { head: ctx.run.branchName, base: ctx.run.baseBranch, ...prText(ctx, shots) }));
        number = pr.number;
        await ctx.recordPrNumber(number);
        // The first time the run knows its pull request, its tasks wait for review. Run state only gets the
        // number when this node passes, so a wake while CI runs finds it again; the run's column says it is not new.
        if (ctx.run.prNumber === null) await movePlan(deps.projects, ctx, "In review");
      } else if (pushing && (coderOutput(ctx)?.pr || shots.length)) {
        // A later round rewrote the description of the change or took new screenshots; the pull request follows it.
        await deps.github.updatePr(repo, number, prText(ctx, shots));
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
        // Without webhooks (the relay is not running, or the repository has none) the reconcile is the only wake: look sooner.
        const heard = await webhooksSince(deps.db, repoId, ctx.execution.id);
        const reconcileMs = heard ? (deps.reconcileMs ?? 10 * 60_000) : Math.min(deps.noWebhookPollMs ?? 60_000, deps.reconcileMs ?? Infinity);
        if (!heard) ctx.emit("github.no_webhooks", { number, pollSeconds: Math.round(reconcileMs / 1000) });
        const reconcile = Math.min(Date.now() + reconcileMs, noChecks ? Date.now() + Math.max(0, noChecksMs - sincePush) + 1_000 : Infinity);
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
 * Returns the linked issues that are closed now, by GitHub or by this call.
 */
async function closeLinkedIssues(github: GitHubPort, ctx: ExecutorContext, repo: RepoRef, prNumber: number): Promise<number[]> {
  const closedNow: number[] = [];
  const closedHere: number[] = [];
  for (const { number } of ctx.state.issues ?? []) {
    try {
      if ((await github.getIssue(repo, number)).state === "open") {
        await github.closeIssue(repo, number, `Fixed by #${prNumber}, merged by handoff run \`${ctx.run.id}\`.`);
        closedHere.push(number);
      }
      closedNow.push(number);
    } catch (error) {
      ctx.emit("github.issue_close_failed", { number, message: (error as Error).message });
    }
  }
  if (closedHere.length) ctx.emit("github.issues_closed", { numbers: closedHere });
  return closedNow;
}

/** The run's linked issues that are open on GitHub; an issue that cannot be read is left out. */
async function openLinkedIssues(github: GitHubPort, ctx: ExecutorContext, repo: RepoRef): Promise<Set<number>> {
  const issues = ctx.state.issues ?? [];
  const open = await Promise.all(issues.map((i) => github.getIssue(repo, i.number).then((d) => d.state === "open", () => false)));
  return new Set(issues.filter((_, index) => open[index]).map((i) => i.number));
}

/**
 * Closes each parent whose last open sub-issue the merge closed, then that parent's own parent the same
 * way, up to the epic, and sets each one it closed to Done on the plan with the Status it had. `finished`
 * are the issues the merge closed. A parent with an open sub-issue, or already closed, is left as it is.
 * A failure is a `github.parent_close_failed` event and never fails the merge.
 */
async function closeFinishedParents(github: GitHubPort, projects: ProjectsPort | undefined, ctx: ExecutorContext, repo: RepoRef, prNumber: number, finished: number[]) {
  const plan = ctx.project.planProjectNumber;
  // Read before the close: GitHub's "Item closed" workflow may set Done on the item as soon as it closes.
  const statusOf = async (issue: number) => (projects && plan !== null ? projects.getStatus(repo, plan, issue).catch(() => undefined) : undefined);
  const before = new Map<number, PlanStatus | undefined>();
  const closed: number[] = [];
  const seen = new Set<number>();
  for (let level = finished; level.length; ) {
    const next: number[] = [];
    for (const child of level) {
      let parent: number | undefined;
      try {
        parent = (await github.getIssue(repo, child, { parents: true })).parents?.[0]?.number;
        if (parent === undefined || seen.has(parent)) continue;
        seen.add(parent);
        if ((await github.listSubIssues(repo, parent)).some((s) => s.state === "open")) continue;
        if ((await github.getIssue(repo, parent)).state !== "open") continue;
        before.set(parent, await statusOf(parent));
        await github.closeIssue(repo, parent, `Finished by #${prNumber}, merged by handoff run \`${ctx.run.id}\`, which closed #${child}, its last open sub-issue.`);
        closed.push(parent);
        next.push(parent);
      } catch (error) {
        ctx.emit("github.parent_close_failed", { parent: parent ?? null, child, message: (error as Error).message });
      }
    }
    level = next;
  }
  if (closed.length === 0) return;
  ctx.emit("github.parents_closed", { numbers: closed });
  const written = await writePlanStatus(projects, ctx.project, closed, "Done", before);
  for (const event of written) ctx.emit(event.type, event.payload);
}

/** Whether this execution already recorded an event of this type, across its waits. */
async function emittedBefore(db: Db, executionId: string, type: string) {
  const [row] = await db.select({ id: events.id }).from(events).where(and(eq(events.nodeExecutionId, executionId), eq(events.type, type))).limit(1);
  return row !== undefined;
}

/** The payload of this execution's latest event of this type, across its waits. */
async function lastPayload(db: Db, executionId: string, type: string) {
  const [row] = await db
    .select({ payload: events.payload })
    .from(events)
    .where(and(eq(events.nodeExecutionId, executionId), eq(events.type, type)))
    .orderBy(desc(events.seq))
    .limit(1);
  return row?.payload as { threads?: { url: string }[] } | undefined;
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
 * is behind it goes back on the update edge to catch up, keeping its place. One that GitHub reports as
 * blocked while it has unresolved review threads waits, keeping its place, until a person resolves them:
 * the step names the threads and notifies once. Merging wakes the queue.
 */
export function mergeNodeExecutor(deps: { github: GitHubPort; db?: Db; projects?: ProjectsPort | undefined }): NodeExecutor {
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
            await ctx.notify("ready", { title: `${ctx.project.name}: PR #${number} is ready to merge`, body: brief(ctx.run.task), href: runPath(ctx.project.id, ctx.run.id) });
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
      // A ruleset that requires resolved conversations blocks the merge while a review thread is open. Resolving
      // one is a person's call, so the step names the threads and waits for a webhook or the next look.
      const review = await deps.github.unresolvedReviewThreads(repo, number);
      if (review.mergeState === "BLOCKED" && review.threads.length > 0) {
        let repoId = ctx.project.repoId;
        if (repoId === null) {
          repoId = await deps.github.getRepoId(repo);
          await ctx.recordRepoId(repoId);
        }
        const key = prKey(repoId, number);
        await ctx.registerWait(key);
        const before = db ? await lastPayload(db, ctx.execution.id, "merge.threads_unresolved") : undefined;
        const urls = (threads: { url: string }[]) => threads.map((t) => t.url).join("\n");
        if (!before || urls(before.threads ?? []) !== urls(review.threads)) {
          ctx.emit("merge.threads_unresolved", { number, url: snapshot.url, threads: review.threads });
        }
        if (!before) {
          const count = review.threads.length;
          await ctx.notify("input", { title: `${ctx.project.name}: PR #${number} has ${count} unresolved review ${count === 1 ? "thread" : "threads"}`, body: brief(ctx.run.task), href: snapshot.url });
        }
        return { kind: "waiting", wait: { kind: "github_pr", key, deadlineAt: new Date(Date.now() + BLOCKED_RECHECK_MS) } };
      }
      const method = ctx.node.config.method === "merge" || ctx.node.config.method === "rebase" ? ctx.node.config.method : "squash";
      try {
        // Only an issue still open now is one this merge closes; a parent never closes for an issue closed by hand.
        const openBefore = await openLinkedIssues(deps.github, ctx, repo);
        const result = await deps.github.mergePr(repo, number, method);
        if (!result.merged) return done({ kind: "failed", error: { code: "merge_failed", message: `GitHub did not merge PR #${number}` } });
        ctx.emit("github.merged", { number, sha: result.sha });
        await ctx.notify("merged", { title: `${ctx.project.name}: PR #${number} merged`, body: brief(ctx.run.task), href: runPath(ctx.project.id, ctx.run.id) });
        const closedNow = await closeLinkedIssues(deps.github, ctx, repo, number);
        // GitHub's "Item closed" workflow usually gets there first; writing Done again is harmless.
        await movePlan(deps.projects, ctx, "Done");
        await closeFinishedParents(deps.github, deps.projects, ctx, repo, number, closedNow.filter((n) => openBefore.has(n)));
        // Closed issues may unblock other runs of the project waiting at their Start, and tasks the scheduler may start.
        // Runs held on overlap check again, since the merged work is on the base now.
        if (db) {
          await wakeDependents(db, ctx.project.id);
          await nudgeScheduler(db, ctx.project.id);
          await wakeOverlapHeld(db, ctx.project.id);
        }
        return done({ kind: "completed", output: { merged: true, ...(result.sha ? { sha: result.sha } : {}) } });
      } catch (error) {
        return done({ kind: "failed", error: { code: "merge_failed", message: (error as Error).message } });
      }
    },
  };
}
