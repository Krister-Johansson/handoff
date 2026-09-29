import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CoderOutput, PlannerOutput } from "@handoff/core";
import { prKey, toFeedback, type GitHubPort, type RepoRef } from "@handoff/github";
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
  lines.push(`Opened by handoff run \`${ctx.run.id}\`.`);
  return lines.join("\n");
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

      if (!ctx.execution.wakeReason) {
        if (!ctx.workdir) return { kind: "failed", error: { code: "no_workdir", message: "PR node needs the run worktree to push" } };
        const auth = await deps.github.gitAuthConfig(repo);
        await execFileAsync("git", [...auth, "push", "--force-with-lease", "-u", "origin", `HEAD:refs/heads/${ctx.run.branchName}`], {
          cwd: ctx.workdir.path,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        });
      }

      let number = ctx.state.prNumber;
      if (number === undefined) {
        const pr =
          (await deps.github.findPrByHead(repo, ctx.run.branchName)) ??
          (await deps.github.createPr(repo, { head: ctx.run.branchName, base: ctx.run.baseBranch, title: title(ctx.state.task), body: prBody(ctx) }));
        number = pr.number;
      }
      const repoId = ctx.project.repoId ?? (await deps.github.getRepoId(repo));
      const key = prKey(repoId, number);
      await ctx.registerWait(key);

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
        return { kind: "completed", output: { merged: true, ...(result.sha ? { sha: result.sha } : {}) } };
      } catch (error) {
        return { kind: "failed", error: { code: "merge_failed", message: (error as Error).message } };
      }
    },
  };
}
