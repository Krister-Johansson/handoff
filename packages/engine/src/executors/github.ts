import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ReviewerOutputSchema, type CoderOutput, type PlannerOutput } from "@handoff/core";
import { prKey, REVIEWER_NOTES_MARKER, toFeedback, type GitHubPort, type RepoRef } from "@handoff/github";
import type { ExecutorContext, ExecutorOutcome, NodeExecutor } from "../types.ts";

const execFileAsync = promisify(execFile);

const repoOf = (ctx: ExecutorContext): RepoRef => ({ owner: ctx.project.repoOwner, name: ctx.project.repoName });

const flag = (config: Record<string, unknown>, key: string, fallback: boolean) =>
  typeof config[key] === "boolean" ? (config[key] as boolean) : fallback;

function prBody(ctx: ExecutorContext): string {
  const plan = ctx.state.plan as PlannerOutput | undefined;
  const coder = ctx.state.nodes.coder?.output as CoderOutput | undefined;
  const lines = [`Task: ${ctx.state.task}`, ""];
  if (coder?.summary) lines.push("## Summary", "", coder.summary, "");
  if (plan) lines.push("## Plan", "", plan.plan, "", ...plan.steps.map((s) => `- ${s}`), "");
  // GitHub closes these issues when the pull request merges into the default branch.
  if (ctx.state.issues?.length) lines.push(...ctx.state.issues.map((i) => `Closes #${i.number}`), "");
  lines.push(`Opened by handoff run \`${ctx.run.id}\`.`);
  return lines.join("\n");
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

const title = (task: string) => (task.length > 72 ? `${task.slice(0, 69)}...` : task);

/**
 * Pushes the run branch, opens or reuses its pull request, then reports CI and review state as
 * feedback. Waits (without holding a process) while checks are pending, or while an approval is
 * required and missing. Routing on the output decides between merge and a loop back to the Coder.
 */
export function prNodeExecutor(deps: { github: GitHubPort; reconcileMs?: number }): NodeExecutor {
  return {
    needsWorkdir: true,
    async execute(ctx): Promise<ExecutorOutcome> {
      const repo = repoOf(ctx);
      const requireChecks = flag(ctx.node.config, "requireChecks", true);
      const requireApproval = flag(ctx.node.config, "requireApproval", false);

      const pushing = !ctx.execution.wakeReason;
      if (pushing) {
        if (!ctx.workdir) return { kind: "failed", error: { code: "no_workdir", message: "PR node needs the run worktree to push" } };
        const auth = await deps.github.gitAuthEnv(repo);
        await execFileAsync("git", ["push", "--force-with-lease", "-u", "origin", `HEAD:refs/heads/${ctx.run.branchName}`], {
          cwd: ctx.workdir.path,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...auth },
        });
      }

      let number = ctx.state.prNumber;
      if (number === undefined) {
        const pr =
          (await deps.github.findPrByHead(repo, ctx.run.branchName)) ??
          (await deps.github.createPr(repo, { head: ctx.run.branchName, base: ctx.run.baseBranch, title: title(ctx.state.task), body: prBody(ctx) }));
        number = pr.number;
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
      const feedback = toFeedback(snapshot, logs);
      ctx.emit("github.pr", { number, url: snapshot.url, headSha: snapshot.headSha, ci: feedback.ci.status, review: feedback.review.decision });

      const checksPending = requireChecks && feedback.ci.status === "pending" && snapshot.state === "open";
      const awaitingApproval =
        requireApproval && feedback.review.decision === "none" && feedback.ci.status !== "failure" && snapshot.state === "open";
      if (checksPending || awaitingApproval) {
        return {
          kind: "waiting",
          wait: { kind: "github_pr", key, deadlineAt: new Date(Date.now() + (deps.reconcileMs ?? 10 * 60_000)) },
        };
      }
      const output = { prNumber: number, prUrl: snapshot.url, headSha: snapshot.headSha, feedback };
      return { kind: "completed", output, statePatch: { prNumber: number, feedback } };
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

/** Merges the run's pull request (squash by default). */
export function mergeNodeExecutor(deps: { github: GitHubPort }): NodeExecutor {
  return {
    needsWorkdir: false,
    async execute(ctx): Promise<ExecutorOutcome> {
      const number = ctx.state.prNumber;
      if (number === undefined) return { kind: "failed", error: { code: "no_pr", message: "no pull request recorded in run state" } };
      const repo = repoOf(ctx);
      const snapshot = await deps.github.getPrSnapshot(repo, number);
      if (snapshot.merged) return { kind: "completed", output: { merged: true } };
      const method = ctx.node.config.method === "merge" || ctx.node.config.method === "rebase" ? ctx.node.config.method : "squash";
      try {
        const result = await deps.github.mergePr(repo, number, method);
        if (!result.merged) return { kind: "failed", error: { code: "merge_failed", message: `GitHub did not merge PR #${number}` } };
        ctx.emit("github.merged", { number, sha: result.sha });
        await closeLinkedIssues(deps.github, ctx, repo, number);
        return { kind: "completed", output: { merged: true, ...(result.sha ? { sha: result.sha } : {}) } };
      } catch (error) {
        return { kind: "failed", error: { code: "merge_failed", message: (error as Error).message } };
      }
    },
  };
}
