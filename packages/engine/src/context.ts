import { nodeCatalog, type CheckResult, type CompiledNode, type ContextPacket, type ReviewComment, type RunState } from "@handoff/core";
import type { NodeExecutionRow } from "@handoff/db";

export const DEFAULT_MAX_TURNS = 60;

function pick(state: RunState, keys: string[]): Record<string, unknown> {
  const source = state as Record<string, unknown>;
  return Object.fromEntries(keys.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]));
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/**
 * Feedback carried by the output of the node that sent this execution back: failing tests, review
 * comments, CI failures with log tails. Recognised by output shape, so custom nodes can reuse it.
 */
export function feedbackFrom(output: unknown): { failedChecks: CheckResult[]; reviewComments: ReviewComment[] } {
  const o = obj(output);
  const failedChecks: CheckResult[] = [];
  const reviewComments: ReviewComment[] = [];
  if (o.passed === false && typeof o.command === "string") {
    failedChecks.push({ kind: "tests", passed: false, detail: `\`${o.command}\` exited ${String(o.exitCode)}`, logTail: String(o.tail ?? "") });
  }
  if (o.verdict === "request_changes" && Array.isArray(o.comments)) {
    for (const c of o.comments.map(obj)) {
      reviewComments.push({
        author: "reviewer",
        body: String(c.body ?? ""),
        ...(typeof c.path === "string" ? { path: c.path } : {}),
        ...(typeof c.line === "number" ? { line: c.line } : {}),
        resolved: false,
      });
    }
  }
  // A person at a Human gate who asked for changes, commenting on quoted parts of what they reviewed.
  if (typeof o.option === "string" && Array.isArray(o.comments)) {
    for (const c of o.comments.map(obj)) {
      reviewComments.push({ author: "person", body: String(c.body ?? ""), ...(typeof c.quote === "string" ? { quote: c.quote } : {}), resolved: false });
    }
  }
  const feedback = obj(o.feedback);
  const ci = obj(feedback.ci);
  if (Array.isArray(ci.failedJobs)) {
    for (const job of ci.failedJobs.map(obj)) {
      failedChecks.push({ kind: `ci: ${String(job.name)}`, passed: false, detail: String(job.url ?? ""), logTail: String(job.logExcerpt ?? "") });
    }
  }
  const review = obj(feedback.review);
  if (Array.isArray(review.comments)) {
    for (const c of review.comments.map(obj)) {
      if (c.resolved === true) continue;
      reviewComments.push({
        author: String(c.author ?? "reviewer"),
        body: String(c.body ?? ""),
        ...(typeof c.path === "string" ? { path: c.path } : {}),
        ...(typeof c.line === "number" ? { line: c.line } : {}),
        resolved: false,
      });
    }
  }
  return { failedChecks, reviewComments };
}

/** Decisions people made at review gates, which the gate appends to run state. */
function decisionsOf(state: RunState): NonNullable<ContextPacket["decisions"]> {
  const raw = (state as { decisions?: unknown }).decisions;
  if (!Array.isArray(raw)) return [];
  return raw.map(obj).map((d) => ({
    gate: String(d.gate ?? ""),
    ...(typeof d.note === "string" ? { note: d.note } : {}),
    comments: (Array.isArray(d.comments) ? d.comments.map(obj) : []).map((c) => ({ ...(typeof c.quote === "string" ? { quote: c.quote } : {}), body: String(c.body ?? "") })),
  }));
}

/** What the node is allowed to believe: a slice of run state, owned paths, and why it is running again. */
export function selectContext(node: CompiledNode, state: RunState, execution: NodeExecutionRow): ContextPacket {
  const selector = node.contextSelector;
  const defaultKeys = ["plan", "prNumber", ...(selector.includeFeedback ? ["feedback"] : [])];
  const stateSlice = pick(state, selector.stateKeys.length ? selector.stateKeys : defaultKeys);
  const ownedPaths = state.plan?.ownedPaths ?? [];
  const configTools = node.config.allowedTools;
  const allowedTools = Array.isArray(configTools) ? configTools.map(String) : nodeCatalog[node.type].allowedTools;
  const maxTurns = typeof node.config.maxTurns === "number" ? node.config.maxTurns : DEFAULT_MAX_TURNS;

  const packet: ContextPacket = {
    task: state.task,
    nodeKey: node.key,
    stateSlice,
    repoPaths: selector.repoPaths.length ? selector.repoPaths : ownedPaths,
    constraints: { ownedPaths, allowedTools, maxTurns },
    outputContract: node.contract.output,
    ...(typeof node.config.instructions === "string" && node.config.instructions.trim() ? { instructions: node.config.instructions.trim() } : {}),
    ...(decisionsOf(state).length ? { decisions: decisionsOf(state) } : {}),
    ...(state.issues?.length ? { issues: state.issues } : {}),
  };

  const trigger = execution.trigger;
  if (selector.includePriorAttempt && trigger?.kind === "edge" && trigger.from && trigger.from !== node.key) {
    const from = state.nodes[trigger.from];
    const answer = state.human[trigger.from];
    if (answer) packet.humanAnswer = answer.option ? `${answer.option}: ${answer.answer}` : answer.answer;
    const { failedChecks, reviewComments } = feedbackFrom(from?.output);
    if (failedChecks.length || reviewComments.length || answer) {
      packet.priorAttempt = { summary: `Sent back by ${trigger.from} via ${trigger.edgeKey}.`, failedChecks, reviewComments };
    }
  }
  const lastFailure = state.nodes[node.key]?.lastFailure;
  if (selector.includePriorAttempt && !packet.priorAttempt && lastFailure) {
    packet.priorAttempt = {
      summary: `Attempt ${execution.attempt - 1} failed: ${JSON.stringify(lastFailure.error)}`,
      failedChecks: (lastFailure.checks ?? []) as CheckResult[],
      reviewComments: [],
    };
  }
  if (execution.repairNote) packet.repairNote = execution.repairNote;
  return packet;
}
