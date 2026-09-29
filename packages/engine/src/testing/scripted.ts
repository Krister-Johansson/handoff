import type { ExecutorContext, ExecutorOutcome, NodeExecutor } from "../types.ts";

/** Executor whose outcome per call comes from a script; the last entry repeats. */
export function scripted(...outcomes: (ExecutorOutcome | ((ctx: ExecutorContext, call: number) => ExecutorOutcome | Promise<ExecutorOutcome>))[]): NodeExecutor & {
  calls: ExecutorContext[];
} {
  const calls: ExecutorContext[] = [];
  return {
    needsWorkdir: false,
    calls,
    async execute(ctx) {
      calls.push(ctx);
      const next = outcomes[Math.min(calls.length - 1, outcomes.length - 1)]!;
      return typeof next === "function" ? next(ctx, calls.length) : next;
    },
  };
}

export const done = (output: unknown, statePatch?: Record<string, unknown>): ExecutorOutcome => ({
  kind: "completed",
  output,
  ...(statePatch ? { statePatch } : {}),
});

export const outputs = {
  planner: { plan: "p", steps: ["s"], ownedPaths: ["CHANGELOG.md"] },
  coderDone: { status: "done", summary: "done" },
  coderAsks: { status: "needs_input", summary: "unsure", question: { text: "ISO dates or US dates?", options: ["ISO", "US"] } },
  testsPass: { passed: true, command: "npm test", exitCode: 0, tail: "ok" },
  testsFail: { passed: false, command: "npm test", exitCode: 1, tail: "FAIL changelog.test.ts\nexpected ISO date" },
  approve: { verdict: "approve", comments: [] },
  requestChanges: { verdict: "request_changes", comments: [{ path: "CHANGELOG.md", line: 3, body: "Use ISO dates" }] },
  prGreen: {
    prNumber: 1,
    prUrl: "https://github.com/octo/sample/pull/1",
    headSha: "a",
    feedback: { ci: { status: "success", failedJobs: [] }, review: { decision: "none", comments: [], unresolvedThreads: 0 }, updatedAt: "now" },
  },
  prRed: {
    prNumber: 1,
    prUrl: "https://github.com/octo/sample/pull/1",
    headSha: "a",
    feedback: {
      ci: { status: "failure", failedJobs: [{ name: "test", jobId: 5, url: "https://ci/5", logExcerpt: "Error: date format" }] },
      review: { decision: "none", comments: [], unresolvedThreads: 0 },
      updatedAt: "now",
    },
  },
};
