import { acceptanceOf, ALL_TOOLS, memoryOf, type CheckResult, type CompiledNode, type ContextPacket, nodeCatalog, PrConflictOutputSchema, type ReviewComment, type RunState } from "@handoff/core";
import type { NodeExecutionRow } from "@handoff/db";

export const DEFAULT_MAX_TURNS = 60;

function pick(state: RunState, keys: string[]): Record<string, unknown> {
  const source = state as Record<string, unknown>;
  return Object.fromEntries(keys.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]));
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** The file and lines a comment points at, when it has them. */
const placeOf = (c: Record<string, unknown>) => ({
  ...(typeof c.path === "string" ? { path: c.path } : {}),
  ...(typeof c.line === "number" ? { line: c.line } : {}),
  ...(typeof c.endLine === "number" ? { endLine: c.endLine } : {}),
});

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
  // A person at a Human gate who asked for changes, commenting on quoted parts or lines of what they reviewed.
  if (typeof o.option === "string" && Array.isArray(o.comments)) {
    for (const c of o.comments.map(obj)) {
      reviewComments.push({ author: "person", body: String(c.body ?? ""), ...placeOf(c), ...(typeof c.quote === "string" ? { quote: c.quote } : {}), resolved: false });
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
    comments: (Array.isArray(d.comments) ? d.comments.map(obj) : []).map((c) => ({ ...placeOf(c), ...(typeof c.quote === "string" ? { quote: c.quote } : {}), body: String(c.body ?? "") })),
  }));
}

/**
 * Comments that came with an approval, from any other step whose latest output approves: advice the
 * run would otherwise drop, since only request_changes sends comments back. Recognised by shape.
 */
function suggestionsOf(state: RunState, self: string): NonNullable<ContextPacket["suggestions"]> {
  return Object.entries(state.nodes).flatMap(([key, result]) => {
    const o = obj(result.output);
    if (key === self || o.verdict !== "approve" || !Array.isArray(o.comments) || o.comments.length === 0) return [];
    const comments = o.comments.map(obj).map((c) => ({
      ...(typeof c.path === "string" ? { path: c.path } : {}),
      ...(typeof c.line === "number" ? { line: c.line } : {}),
      body: String(c.body ?? ""),
    }));
    return [{ from: key, comments }];
  });
}

/** What the node is allowed to believe: a slice of run state, owned paths, and why it is running again. */
const REVIEW_TYPES = new Set(["reviewer", "code_review"]);

/**
 * A reviewer's own last request for changes, when it runs again: its comments, what the step it sent
 * the work back to said it changed, and the commit it reviewed, so it checks those instead of
 * reviewing everything from scratch.
 */
function previousReviewOf(node: CompiledNode, state: RunState, sentBackTo: string[]): ContextPacket["previousReview"] {
  if (!REVIEW_TYPES.has(node.type)) return undefined;
  const last = obj(state.nodes[node.key]?.output);
  if (last.verdict !== "request_changes" || !Array.isArray(last.comments) || last.comments.length === 0) return undefined;
  const reply = sentBackTo.map((key) => obj(state.nodes[key]?.output).summary).find((s): s is string => typeof s === "string" && s.trim() !== "");
  const reviewedAt = obj(state.reviewedAt)[node.key];
  return {
    comments: last.comments.map(obj).map((c) => ({ ...placeOf(c), body: String(c.body ?? "") })),
    ...(reply ? { reply } : {}),
    ...(typeof reviewedAt === "string" ? { reviewedAt } : {}),
  };
}

export function selectContext(node: CompiledNode, state: RunState, execution: NodeExecutionRow, sentBackTo: string[] = []): ContextPacket {
  const selector = node.contextSelector;
  const defaultKeys = ["plan", "prNumber", ...(selector.includeFeedback ? ["feedback"] : [])];
  const stateSlice = pick(state, selector.stateKeys.length ? selector.stateKeys : defaultKeys);
  const ownedPaths = state.plan?.ownedPaths ?? [];
  const configTools = node.config.allowedTools;
  const allowedTools =
    node.config.allTools === true ? ALL_TOOLS : Array.isArray(configTools) ? configTools.map(String) : nodeCatalog[node.type].allowedTools;
  const maxTurns = typeof node.config.maxTurns === "number" ? node.config.maxTurns : DEFAULT_MAX_TURNS;

  const acceptance = acceptanceOf(state);
  const packet: ContextPacket = {
    task: state.task,
    nodeKey: node.key,
    stateSlice,
    repoPaths: selector.repoPaths.length ? selector.repoPaths : ownedPaths,
    constraints: { ownedPaths, allowedTools, maxTurns },
    outputContract: node.contract.output,
    ...(typeof node.config.instructions === "string" && node.config.instructions.trim() ? { instructions: node.config.instructions.trim() } : {}),
    ...(decisionsOf(state).length ? { decisions: decisionsOf(state) } : {}),
    ...(suggestionsOf(state, node.key).length ? { suggestions: suggestionsOf(state, node.key) } : {}),
    ...(state.issues?.length ? { issues: state.issues } : {}),
    ...(acceptance ? { acceptance } : {}),
  };
  const previousReview = previousReviewOf(node, state, sentBackTo);
  if (previousReview) packet.previousReview = previousReview;

  const trigger = execution.trigger;
  if (selector.includePriorAttempt && trigger?.kind === "edge" && trigger.from && trigger.from !== node.key) {
    const from = state.nodes[trigger.from];
    const answer = state.human[trigger.from];
    if (answer) packet.humanAnswer = answer.option ? `${answer.option}: ${answer.answer}` : answer.answer;
    const { failedChecks, reviewComments } = feedbackFrom(from?.output);
    // Sent back by a pull request that conflicts with the base branch: the work is the merge.
    const conflict = PrConflictOutputSchema.safeParse(from?.output);
    if (conflict.success) packet.conflict = conflict.data.conflict;
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
  const memory = memoryOf(state, node.key);
  if (memory.extraPaths.length || memory.notes.length || memory.answers.length) packet.memory = memory;
  return packet;
}
