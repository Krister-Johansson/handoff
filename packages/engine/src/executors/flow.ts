import type { ExecutorOutcome, NodeExecutor } from "../types.ts";

/** A Start node: the run's trigger (a person pressing Run, for now), passing on the task and linked issues. */
export function startExecutor(): NodeExecutor {
  return {
    needsWorkdir: false,
    async execute(ctx): Promise<ExecutorOutcome> {
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
