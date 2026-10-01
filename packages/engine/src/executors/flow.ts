import type { GitHubPort } from "@handoff/github";
import { depsKey } from "../dependencies.ts";
import type { ExecutorOutcome, NodeExecutor } from "../types.ts";

/** How long a blocked run waits before it asks GitHub again, should a wake be missed. */
const BLOCKED_RECHECK_MS = 5 * 60_000;

/**
 * A Start node: the run's trigger (a person pressing Run, for now), passing on the task and linked
 * issues. With GitHub, it first waits while GitHub records an open issue blocking one of the linked
 * issues, so the run branches off main only once the work it builds on has merged.
 */
export function startExecutor(deps: { github?: GitHubPort } = {}): NodeExecutor {
  return {
    needsWorkdir: false,
    async execute(ctx): Promise<ExecutorOutcome> {
      if (deps.github && ctx.state.issues?.length) {
        const repo = { owner: ctx.project.repoOwner, name: ctx.project.repoName };
        const blocked = (await Promise.all(ctx.state.issues.map(async (i) => ({ issue: i.number, blockedBy: await deps.github!.openBlockers(repo, i.number) })))).filter(
          (b) => b.blockedBy.length > 0,
        );
        if (blocked.length) {
          // Only on news, not on every periodic recheck.
          if (ctx.execution.wakeReason !== "timeout") for (const b of blocked) ctx.emit("run.blocked", b);
          const key = depsKey(ctx.project.id);
          await ctx.registerWait(key);
          return { kind: "waiting", wait: { kind: "timer", key, deadlineAt: new Date(Date.now() + BLOCKED_RECHECK_MS) } };
        }
      }
      const issues = (ctx.state.issues ?? []).map((i) => ({ number: i.number, title: i.title, url: i.url }));
      return { kind: "completed", output: { trigger: "run", task: ctx.state.task, issues } };
    },
  };
}

/** A Finish node: records the end of the run and whether to notify; the dashboard does the notifying. */
export function finishExecutor(): NodeExecutor {
  return {
    needsWorkdir: false,
    async execute(ctx): Promise<ExecutorOutcome> {
      const notify = ctx.node.config.notify !== false;
      ctx.emit("run.finish", { notify });
      return { kind: "completed", output: { notified: notify } };
    },
  };
}
