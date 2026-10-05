import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { appendEvents, edgeTraversals, events, graphs, graphVersions, nodeExecutions, permissionRequests, projects as projectRows, questions, runs, wakeByToken, type Db, type DbTx, type QuestionChoice, type QuestionComment } from "@handoff/db";
import { compileGraph, PlanPartSchema, remember, ReviewerOutputSchema, RunStateSchema, type PlanPart, type ReviewerOutput, type RunState } from "@handoff/core";
import type { GitHubPort, PlanStatus, ProjectsPort } from "@handoff/github";
import { nudgeScheduler, wakeOverlapHeld } from "./backlog-scheduler/nudge.ts";
import { loadCompiledGraph } from "./graph-cache.ts";
import { recordPlanStatus } from "./plan-status.ts";
import { stopRunPreviews } from "./preview/preview.ts";
import { createExecution } from "./scheduler/complete.ts";

/**
 * Re-runs a failed node execution as a new attempt, keeping every upstream result in run state.
 * `allowPaths` are files outside the plan a person allows for the node's later attempts in this run.
 * `latestGraph` first moves the run to the newest version of its graph, so the new attempt runs that
 * version's node; `graphUpgrade` says when it refuses.
 */
export async function repairNodeExecution(db: Db, executionId: string, opts: { note?: string; allowPaths?: string[]; latestGraph?: boolean }) {
  return db.transaction(async (tx) => {
    const [failed] = await tx.select().from(nodeExecutions).where(eq(nodeExecutions.id, executionId)).for("update");
    if (!failed) throw new Error(`execution ${executionId} not found`);
    if (failed.status !== "failed") throw new Error(`only failed executions can be repaired; ${failed.nodeKey} is ${failed.status}`);
    const [run] = await tx.select().from(runs).where(eq(runs.id, failed.runId)).for("update");
    if (run?.status === "cancelled") throw new Error("the run was cancelled");
    const upgrade = opts.latestGraph ? await graphUpgrade(tx, run!, failed.nodeKey) : undefined;
    const [{ attempt } = { attempt: 0 }] = await tx
      .select({ attempt: sql<number>`coalesce(max(${nodeExecutions.attempt}), 0)::int` })
      .from(nodeExecutions)
      .where(and(eq(nodeExecutions.runId, failed.runId), eq(nodeExecutions.nodeKey, failed.nodeKey)));
    const [created] = await tx
      .insert(nodeExecutions)
      .values({
        runId: failed.runId,
        nodeKey: failed.nodeKey,
        // The new version may give the key another type.
        nodeType: upgrade ? upgrade.graph.node(failed.nodeKey).type : failed.nodeType,
        executorKind: upgrade ? upgrade.graph.executorKind(failed.nodeKey) : failed.executorKind,
        attempt: attempt + 1,
        repairedFromExecutionId: failed.id,
        repairNote: opts.note ?? null,
        trigger: { kind: "repair", fromExecutionId: failed.id },
      })
      .returning();
    const allowPaths = [...new Set((opts.allowPaths ?? []).map((p) => p.trim()).filter(Boolean))];
    // Written to the state read under the run's lock, so nothing another step wrote meanwhile is lost.
    const reason = `Allowed when the step was repaired${opts.note ? `: ${opts.note}` : "."}`;
    const state = allowPaths.length
      ? { state: remember(RunStateSchema.parse(run!.state), failed.nodeKey, { extraPaths: allowPaths.map((path) => ({ path, reason, attempt: attempt + 1, by: "person" as const })) }), stateVersion: sql`${runs.stateVersion} + 1` }
      : {};
    const moved = upgrade && { from: upgrade.from, to: upgrade.to };
    await tx
      .update(runs)
      .set({ status: "running", finishedAt: null, ...state, ...(moved ? { graphVersionId: moved.to.graphVersionId } : {}) })
      .where(eq(runs.id, failed.runId));
    // A failed run held the project's scheduler; repaired, it no longer does.
    await nudgeScheduler(tx, run!.projectId);
    await appendEvents(tx, failed.runId, [
      ...(moved ? [{ type: "run.graph_upgraded", payload: moved }] : []),
      { type: "node.repair_requested", payload: { nodeKey: failed.nodeKey, note: opts.note ?? null, ...(allowPaths.length ? { allowPaths } : {}) }, nodeExecutionId: failed.id },
      { type: "node.created", payload: { nodeKey: failed.nodeKey, attempt: attempt + 1, via: "repair" }, nodeExecutionId: created!.id },
    ]);
    return { ...created!, ...(moved ? { upgrade: moved } : {}) };
  });
}

/**
 * The move from the run's graph version to the newest version of the same graph, checked before a
 * repair writes anything. Run state stays as it is: results are keyed by node key and loop counters
 * by edge key, and a key the new version no longer has is never read again.
 */
async function graphUpgrade(tx: DbTx, run: typeof runs.$inferSelect, nodeKey: string) {
  const [current] = await tx
    .select({ graphId: graphVersions.graphId, version: graphVersions.version, name: graphs.name })
    .from(graphVersions)
    .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
    .where(eq(graphVersions.id, run.graphVersionId));
  const [latest] = await tx.select().from(graphVersions).where(eq(graphVersions.graphId, current!.graphId)).orderBy(desc(graphVersions.version)).limit(1);
  const graph = `graph ${current!.name}`;
  if (latest!.version <= current!.version) throw new Error(`the run is already on version ${current!.version} of ${graph}, its latest`);
  const compiled = compileGraph(latest!.document);
  if (!compiled.ok) throw new Error(`version ${latest!.version} of ${graph} does not compile: ${compiled.errors.map((e) => e.message).join("; ")}`);
  if (!compiled.graph.graph.hasNode(nodeKey)) throw new Error(`version ${latest!.version} of ${graph} has no node ${nodeKey}`);
  // A join fires once every inbound edge arrived; an arrival over an edge the new version lacks never counts.
  const arrivals = await tx
    .select({ edgeKey: edgeTraversals.edgeKey, toNodeKey: edgeTraversals.toNodeKey })
    .from(edgeTraversals)
    .where(and(eq(edgeTraversals.runId, run.id), isNull(edgeTraversals.consumedByExecutionId)));
  const lost = arrivals.find((a) => !compiled.graph.graph.hasEdge(a.edgeKey));
  if (lost) throw new Error(`version ${latest!.version} of ${graph} has no edge ${lost.edgeKey}, which ${lost.toNodeKey} waits on`);
  return {
    from: { version: current!.version, graphVersionId: run.graphVersionId },
    to: { version: latest!.version, graphVersionId: latest!.id },
    graph: compiled.graph,
  };
}

/**
 * Cancels a run: stops claiming its work, fails queued and waiting nodes, signals the running one, and stops its apps.
 * With the Projects port, each task the run moved on the plan goes back to the Status it had before
 * (Ready for a task the run started on), unless a newer run links it.
 */
export async function cancelRun(db: Db, runId: string, opts: { reason?: string; projects?: ProjectsPort | undefined } = {}) {
  const cancelled = await db.transaction(async (tx) => {
    const [run] = await tx
      .update(runs)
      .set({ status: "cancelled", cancelRequestedAt: sql`now()`, finishedAt: sql`now()` })
      .where(and(eq(runs.id, runId), inArray(runs.status, ["queued", "running", "waiting", "failed"])))
      .returning();
    if (!run) throw new Error(`run ${runId} is not active`);
    await tx
      .update(nodeExecutions)
      .set({ status: "failed", error: { code: "cancelled", message: "run was cancelled" }, finishedAt: sql`now()` })
      .where(and(eq(nodeExecutions.runId, runId), inArray(nodeExecutions.status, ["pending", "waiting"])));
    await appendEvents(tx, runId, [{ type: "run.cancelled", payload: { reason: opts.reason ?? null } }]);
    // A cancelled run frees a slot, and a failed one no longer holds the project. Runs held on its paths check again.
    await nudgeScheduler(tx, run.projectId);
    await wakeOverlapHeld(tx, run.projectId);
    return run;
  });
  await stopRunPreviews(db, runId);
  const [project] = await db.select().from(projectRows).where(eq(projectRows.id, cancelled.projectId));
  if (!project || project.planProjectNumber === null || cancelled.issues.length === 0) return;
  // Each task the run moved goes back to the Status it had; a task the run never moved keeps its Status.
  const before = await statusesBeforeRun(db, runId);
  const byStatus = new Map<PlanStatus, number[]>();
  for (const issue of await issuesItOwns(db, cancelled)) {
    const status = before.get(issue);
    if (status) byStatus.set(status, [...(byStatus.get(status) ?? []), issue]);
  }
  for (const [status, issues] of byStatus) await recordPlanStatus(db, runId, opts.projects, project, issues, status);
}

/**
 * The Status each task the run moved had before the run moved it, from the `from` of the run's first
 * plan.status for the task that records one. A task the run moved before runs recorded `from` came from
 * Ready, the gate every start passed. A task the run never moved has no entry. A run started again
 * records these as its own `from`.
 */
export async function statusesBeforeRun(db: Db, runId: string): Promise<Map<number, PlanStatus>> {
  const moves = await db
    .select({ payload: events.payload })
    .from(events)
    .where(and(eq(events.runId, runId), eq(events.type, "plan.status")))
    .orderBy(events.seq);
  const moved = new Set<number>();
  const recorded = new Map<number, PlanStatus>();
  for (const { payload } of moves) {
    const { issue, from } = payload as { issue: number; from?: PlanStatus };
    moved.add(issue);
    if (from && !recorded.has(issue)) recorded.set(issue, from);
  }
  return new Map([...moved].map((issue) => [issue, recorded.get(issue) ?? "Ready"]));
}

/** The run's issues no newer run of the project links: a newer run owns the status of its issues. */
async function issuesItOwns(db: Db, run: typeof runs.$inferSelect): Promise<number[]> {
  const newer = await db
    .select({ issues: runs.issues })
    .from(runs)
    // Compared in SQL: a JavaScript Date drops the microseconds Postgres keeps.
    .where(and(eq(runs.projectId, run.projectId), sql`${runs.createdAt} > (select r.created_at from runs r where r.id = ${run.id})`));
  const taken = new Set(newer.flatMap((r) => r.issues.map((i) => i.number)));
  return run.issues.map((i) => i.number).filter((n) => !taken.has(n));
}

/**
 * Records a person's answer to a step's permission request; the step's watcher hands it to Claude Code.
 * A request already answered, or expired when its step ended, cannot be answered again.
 */
export async function decidePermission(db: Db, id: string, input: { allow: boolean; decidedBy: string; message?: string; rule?: string }) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(permissionRequests)
      .set({ status: input.allow ? "allowed" : "denied", decidedBy: input.decidedBy, decidedAt: new Date(), message: input.message ?? null, rule: input.rule ?? null })
      .where(and(eq(permissionRequests.id, id), eq(permissionRequests.status, "pending")))
      .returning();
    if (!row) throw new Error("That request was already answered, or its step has ended.");
    // A pending request held the project's scheduler.
    const [run] = await tx.select({ projectId: runs.projectId }).from(runs).where(eq(runs.id, row.runId));
    if (run) await nudgeScheduler(tx, run.projectId);
    return row;
  });
}

/** Wakes a Try it gate that still waits for its answer, so it starts the run's app again if it stopped. */
export async function restartTryIt(db: Db, questionId: string) {
  const [question] = await db.select().from(questions).where(eq(questions.id, questionId));
  if (!question || question.answer !== null) throw new Error(`question ${questionId} is not waiting`);
  await wakeByToken(db, questionId, { reason: "preview" });
}

/**
 * Records a person's answer and wakes the Human gate waiting on it. `findings` are the code reviewer's
 * findings the person keeps on Fix now, by their place in the review from 0; without it, every Blocking
 * and Should fix finding. Changes and fix send them back. Later steps get only them as suggestions.
 */
type Answer = {
  answer: string;
  option?: string;
  answeredBy: string;
  comments?: QuestionComment[];
  findings?: number[] | undefined;
  /** For a review items question: a choice per item, by handle, with a note. An item without one takes `option`. */
  items?: QuestionChoice[] | undefined;
};
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Reader = Db | Tx;

/** What a review question shows; a code review names the step that reviewed the code in `from`. */
type ReviewShown = { from?: string; kind?: string };

/**
 * The verdict and findings of the code reviewing step a code review question shows: that step's latest
 * execution before the question was asked. Undefined when the question reviews something else.
 */
export async function reviewFindingsOf(db: Reader, question: { runId: string; createdAt: Date; context: Record<string, unknown> }): Promise<{ by: string; findings: ReviewerOutput } | undefined> {
  const review = question.context.review as ReviewShown | undefined;
  if (review?.kind !== "code" || !review.from) return undefined;
  const [step] = await db
    .select({ output: nodeExecutions.output })
    .from(nodeExecutions)
    .where(and(eq(nodeExecutions.runId, question.runId), eq(nodeExecutions.nodeKey, review.from), lt(nodeExecutions.createdAt, question.createdAt)))
    .orderBy(desc(nodeExecutions.createdAt))
    .limit(1);
  const parsed = ReviewerOutputSchema.safeParse(step?.output);
  return parsed.success ? { by: review.from, findings: parsed.data } : undefined;
}

/** Whether a finding goes back to the coder unless the person picks otherwise: every Blocking and Should fix one. */
export const fixNowByDefault = (finding: { severity?: string | undefined }) => finding.severity !== "follow_up";

/**
 * The code reviewer's findings a review answer keeps on Fix now, by their place in the review from 0,
 * and the ones it sends back with changes or fix, as comments on their files attributed to the step
 * that found them. Undefined `kept` when the question shows no code review findings.
 */
async function pickedFindings(tx: Tx, questionId: string, input: Answer): Promise<{ kept?: number[]; comments: QuestionComment[] }> {
  const sendsBack = input.option === "changes" || input.option === "fix";
  const [question] = await tx.select({ runId: questions.runId, createdAt: questions.createdAt, context: questions.context }).from(questions).where(eq(questions.id, questionId));
  const found = question ? await reviewFindingsOf(tx, question) : undefined;
  if (!found) {
    if (sendsBack && input.findings?.length) throw new Error("This review has no code review findings.");
    return { comments: [] };
  }
  const all = found.findings.comments;
  const missing = input.findings?.find((i) => i < 0 || i >= all.length);
  if (missing !== undefined) throw new Error(`There is no finding ${missing + 1}. The review has ${all.length}.`);
  const kept = input.findings ? [...new Set(input.findings)].sort((a, b) => a - b) : all.flatMap((f, i) => (fixNowByDefault(f) ? [i] : []));
  const comments = sendsBack ? kept.map((i) => all[i]!).map((f) => ({ path: f.path, ...(f.line !== undefined ? { line: f.line } : {}), body: f.body, author: found.by })) : [];
  return { kept, comments };
}

/**
 * A review items question's choices, one per item it lists: from `items`, else the option, which applies
 * to every item without one. Refuses an item the question does not list, a choice it does not offer, and an
 * item left without a choice. Null when one option answers every item, or the question is of another kind.
 */
export function itemChoices(question: { options: string[]; context: Record<string, unknown> }, input: Pick<Answer, "answer" | "option" | "items">): QuestionChoice[] | null {
  const given = input.items ?? [];
  if (question.context.reason !== "review_items") {
    if (given.length) throw new Error("This question takes no choice per item.");
    return null;
  }
  const listed = (Array.isArray(question.context.items) ? (question.context.items as { id?: unknown }[]) : []).map((i) => String(i.id));
  const offered = question.options.join(", ");
  for (const [index, c] of given.entries()) {
    if (!listed.includes(c.id)) throw new Error(`The question does not list ${c.id}; it asks about ${listed.join(", ")}.`);
    if (!question.options.includes(c.choice)) throw new Error(`${c.id} takes one of ${offered}; "${c.choice}" is not one of them.`);
    if (given.findIndex((o) => o.id === c.id) !== index) throw new Error(`${c.id} has more than one choice.`);
  }
  const option = input.option !== undefined && question.options.includes(input.option) ? input.option : undefined;
  const missing = listed.filter((id) => !given.some((c) => c.id === id));
  if (missing.length && !option) throw new Error(`Give a choice for ${missing.join(", ")}: one of ${offered}.`);
  if (given.length === 0) return null;
  const note = input.answer.trim() && input.answer.trim() !== option ? input.answer.trim() : "";
  return listed.map((id) => {
    const c = given.find((o) => o.id === id);
    if (c) return { id, choice: c.choice, ...(c.note?.trim() ? { note: c.note.trim() } : {}) };
    return { id, choice: option!, ...(note ? { note } : {}) };
  });
}

export async function answerQuestion(db: Db, questionId: string, input: Answer) {
  // Accepting a split opens the later parts' issues first, which needs GitHub: splitRun answers it.
  if (input.option === "split") throw new Error("Split as proposed opens an issue for each later part first; accept a split through the split, not as a plain answer.");
  return db.transaction(async (tx) => {
    const [asked] = await tx.select({ options: questions.options, context: questions.context }).from(questions).where(eq(questions.id, questionId));
    const choices = asked ? itemChoices(asked, input) : null;
    const { kept, comments } = await pickedFindings(tx, questionId, input);
    return answerIn(tx, questionId, { ...input, comments: [...comments, ...(input.comments ?? [])], findings: kept }, [], choices);
  });
}

/** Records a person's answer to an open question and wakes the step that waits on it. */
async function answerIn(tx: Tx, questionId: string, input: Answer, extra: { type: string; payload: unknown }[] = [], choices: QuestionChoice[] | null = null) {
  const comments = (input.comments ?? [])
    .map(
      (c): QuestionComment => ({
        ...(c.path?.trim() ? { path: c.path.trim() } : {}),
        ...(c.line !== undefined ? { line: c.line } : {}),
        ...(c.endLine !== undefined && c.endLine !== c.line ? { endLine: c.endLine } : {}),
        ...(c.side ? { side: c.side } : {}),
        // Code keeps its indentation; a quote from prose is trimmed.
        ...(c.quote?.trim() ? { quote: c.path ? c.quote : c.quote.trim() } : {}),
        body: c.body.trim(),
        ...(c.author ? { author: c.author } : {}),
      }),
    )
    .filter((c) => c.body);
  const [question] = await tx
    .update(questions)
    .set({ answer: input.answer, option: input.option ?? null, comments, findings: input.findings ?? null, choices, answeredBy: input.answeredBy, answeredAt: sql`now()` })
    .where(and(eq(questions.id, questionId), sql`${questions.answer} is null`))
    .returning();
  if (!question) {
    const [existing] = await tx.select({ id: questions.id }).from(questions).where(eq(questions.id, questionId));
    throw new Error(existing ? "question already answered" : `question ${questionId} not found`);
  }
  await wakeByToken(tx, question.id, { reason: "answer", payload: { option: input.option ?? null, answeredBy: input.answeredBy } });
  // An open question or review held the project's scheduler.
  const [run] = await tx.select({ projectId: runs.projectId }).from(runs).where(eq(runs.id, question.runId));
  if (run) await nudgeScheduler(tx, run.projectId);
  await appendEvents(tx, question.runId, [
    {
      type: "human.answered",
      payload: { questionId: question.id, answer: input.answer, option: input.option ?? null, comments: comments.length, ...(choices ? { choices } : {}), answeredBy: input.answeredBy },
      nodeExecutionId: question.nodeExecutionId,
    },
    ...extra.map((e) => ({ ...e, nodeExecutionId: question.nodeExecutionId })),
  ]);
  return question;
}

/** An issue opened for a later part of a split. */
export type SplitIssue = { number: number; title: string; url: string };

/** The parts a plan gate's question offers to split into, when it offers a split. */
export function splitPartsOf(context: Record<string, unknown>): PlanPart[] | undefined {
  const parsed = PlanPartSchema.array().min(2).safeParse((context.split as { parts?: unknown } | undefined)?.parts);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Accepts the split a plan gate shows, once the later parts' issues are open: the run narrows to the
 * first part (its task becomes that part, and its plan is dropped for the planner to plan the part
 * again) and the gate is answered "split", which sends the work back to the planner. An issue of the run
 * other than its first whose title a later part repeats leaves the run, so its pull request does not
 * close it, and the answer names it. Records `run.split` with the dropped issues.
 */
export async function splitRun(db: Db, questionId: string, input: { note?: string | undefined; answeredBy: string; issues: SplitIssue[] }) {
  return db.transaction(async (tx) => {
    const [question] = await tx.select().from(questions).where(eq(questions.id, questionId)).for("update");
    if (!question) throw new Error(`question ${questionId} not found`);
    if (question.answer !== null) throw new Error("question already answered");
    const parts = splitPartsOf(question.context);
    if (!parts) throw new Error("This question does not offer a split.");
    if (input.issues.length !== parts.length - 1) throw new Error(`A split into ${parts.length} parts needs ${parts.length - 1} issues for the later parts.`);
    const [run] = await tx.select().from(runs).where(eq(runs.id, question.runId)).for("update");
    if (!run) throw new Error(`run ${question.runId} not found`);
    const first = parts[0]!;
    const task = `${first.title}\n\n${first.body.trim()}`;
    // An issue of the run, other than its first, whose title a later part repeats now lives in that part's
    // issue, so the run lets go of it and its pull request does not close it.
    const titleOf = (title: string) => title.trim().toLowerCase();
    const dropped = run.issues.slice(1).flatMap((issue) => {
      const index = parts.findIndex((part, i) => i > 0 && titleOf(part.title) === titleOf(issue.title));
      return index > 0 ? [{ ...issue, heldBy: input.issues[index - 1]!.number }] : [];
    });
    const kept = (issue: { number: number }) => !dropped.some((d) => d.number === issue.number);
    const { plan: _split, ...rest } = RunStateSchema.parse(run.state);
    const state = { ...rest, task, ...(rest.issues ? { issues: rest.issues.filter(kept) } : {}) };
    await tx.update(runs).set({ task, issues: run.issues.filter(kept), state, stateVersion: sql`${runs.stateVersion} + 1` }).where(eq(runs.id, run.id));
    const later = input.issues.map((i) => `#${i.number} "${i.title}"`).join(", ");
    const answer = [
      `Split as proposed. This run builds part 1, "${first.title}", and nothing of the later parts: ${later} hold them, each for a run of its own. Plan part 1 on its own.`,
      ...dropped.map((d) => `#${d.number} "${d.title}" is no longer part of this run; #${d.heldBy} holds its work.`),
      ...(input.note?.trim() ? [input.note.trim()] : []),
    ].join("\n\n");
    return answerIn(tx, questionId, { answer, option: "split", answeredBy: input.answeredBy }, [{ type: "run.split", payload: { questionId, task, issues: input.issues, dropped } }]);
  });
}

/** What unlinking an issue did: the pull request whose description it edited, and the Status it put back on the plan. */
export type UnlinkedIssue = { issue: number; pr: number | null; status: PlanStatus | null };

/**
 * Takes an issue off a run until its pull request merges, so the pull request does not close it and the
 * merge does not set it Done. Under the run's lock it removes the issue from the run's issues and its
 * state, records `run.issue_unlinked` with who did it, and drops the issue's closing line ("Closes #4")
 * from the open pull request's description. With the Projects port, a task the run moved on the plan
 * goes back to the Status it had before the run, unless the run was cancelled or a newer run links it.
 * Refused once the pull request merged, and for a run with a pull request without GitHub.
 */
export async function unlinkIssue(
  db: Db,
  runId: string,
  issue: number,
  opts: { by: string; github?: GitHubPort | undefined; projects?: ProjectsPort | undefined },
): Promise<UnlinkedIssue> {
  const { run, project, pr } = await db.transaction(async (tx) => {
    const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).for("update");
    if (!run) throw new Error(`run ${runId} not found`);
    if (!run.issues.some((i) => i.number === issue)) throw new Error(`Run ${runId} does not link #${issue}.`);
    const kept = (i: { number: number }) => i.number !== issue;
    const state = RunStateSchema.parse(run.state);
    const prNumber = run.prNumber ?? state.prNumber;
    const merged = () => new Error(`Pull request #${prNumber} of run ${runId} merged, so #${issue} stays linked.`);
    if (prNumber !== undefined && (await recordedMerge(tx, runId))) throw merged();
    if (prNumber !== undefined && !opts.github) throw new Error(`Unlinking #${issue} edits pull request #${prNumber}, which needs GitHub access (GITHUB_TOKEN or a GitHub App).`);
    const [project] = await tx.select().from(projectRows).where(eq(projectRows.id, run.projectId));
    const repo = { owner: project!.repoOwner, name: project!.repoName };
    const pr = prNumber !== undefined ? await opts.github!.getPrSnapshot(repo, prNumber) : undefined;
    // Merged by hand on GitHub, or by a merge step the run has not recorded yet.
    if (pr?.merged) throw merged();
    const body = pr?.state === "open" ? withoutClosing(pr.body, issue) : undefined;
    const edits = pr !== undefined && body !== undefined && body !== pr.body;
    await tx
      .update(runs)
      .set({ issues: run.issues.filter(kept), state: { ...state, ...(state.issues ? { issues: state.issues.filter(kept) } : {}) }, stateVersion: sql`${runs.stateVersion} + 1` })
      .where(eq(runs.id, runId));
    await appendEvents(tx, runId, [{ type: "run.issue_unlinked", payload: { issue, by: opts.by, ...(edits ? { pr: pr.number } : {}) } }]);
    // Last, so a refusal from GitHub leaves the run as it was.
    if (edits) await opts.github!.updatePr(repo, pr.number, { title: pr.title, body });
    return { run, project: project!, pr: edits ? pr.number : null };
  });
  const status = await restoreStatus(db, run, project, issue, opts.projects);
  // The run no longer holds the issue, so the scheduler may start it.
  await nudgeScheduler(db, run.projectId);
  return { issue, pr, status };
}

/**
 * Puts an issue the run moved on the plan back to the Status it had before the run. A cancelled run put
 * it back already, and a newer run that links the issue owns its Status. Returns the Status it wrote.
 */
async function restoreStatus(db: Db, run: typeof runs.$inferSelect, project: typeof projectRows.$inferSelect, issue: number, projects: ProjectsPort | undefined): Promise<PlanStatus | null> {
  if (project.planProjectNumber === null || run.status === "cancelled") return null;
  if (!(await issuesItOwns(db, run)).includes(issue)) return null;
  const before = (await statusesBeforeRun(db, run.id)).get(issue);
  if (!before) return null;
  const written = await recordPlanStatus(db, run.id, projects, project, [issue], before);
  return written.some((e) => e.type === "plan.status") ? before : null;
}

/** Whether the run's merge step merged its pull request, or found it merged. */
async function recordedMerge(tx: Tx, runId: string): Promise<boolean> {
  const [event] = await tx.select({ seq: events.seq }).from(events).where(and(eq(events.runId, runId), eq(events.type, "github.merged"))).limit(1);
  if (event) return true;
  const [step] = await tx
    .select({ id: nodeExecutions.id })
    .from(nodeExecutions)
    .where(and(eq(nodeExecutions.runId, runId), eq(nodeExecutions.status, "passed"), sql`${nodeExecutions.output}->>'merged' = 'true'`))
    .limit(1);
  return step !== undefined;
}

/** A pull request description without its lines that close the issue, such as "Closes #4" or "Fixes #4". */
function withoutClosing(body: string, issue: number): string {
  const closing = new RegExp(`^[ \\t]*(close[sd]?|fix(e[sd])?|resolve[sd]?):?[ \\t]+#${issue}[ \\t]*\\.?[ \\t]*(\\r?\\n|$)`, "gim");
  return body.replace(closing, "");
}

export type StuckLoop = { nodeKey: string; edgeKey: string; attempts: number; executionId: string };

/**
 * Where a run stopped because a loop used all its attempts (a reviewer kept sending work back, say):
 * the step that wanted another round and the loop edge. Undefined for any run not stopped that way.
 */
export async function stuckLoop(db: Db, runId: string): Promise<StuckLoop | undefined> {
  const [run] = await db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId));
  if (run?.status !== "failed") return undefined;
  const [failed] = await db.select({ payload: events.payload }).from(events).where(and(eq(events.runId, runId), eq(events.type, "run.failed"))).orderBy(desc(events.seq)).limit(1);
  if ((failed?.payload as { reason?: string } | undefined)?.reason !== "loop_exhausted") return undefined;
  const [exhausted] = await db
    .select({ payload: events.payload, executionId: events.nodeExecutionId })
    .from(events)
    .where(and(eq(events.runId, runId), eq(events.type, "edge.exhausted")))
    .orderBy(desc(events.seq))
    .limit(1);
  if (!exhausted?.executionId) return undefined;
  const [execution] = await db.select({ nodeKey: nodeExecutions.nodeKey }).from(nodeExecutions).where(eq(nodeExecutions.id, exhausted.executionId));
  const payload = exhausted.payload as { edgeKey: string; attempts: number };
  return { nodeKey: execution!.nodeKey, edgeKey: payload.edgeKey, attempts: payload.attempts, executionId: exhausted.executionId };
}

/**
 * A person's decision for a run stuck on a loop that ran out: another round (the loop starts over and
 * the work goes back once more), go on as if the step approved (its forward edges are taken), or stop.
 * Stopping cancels the run, so with the Projects port its tasks go back to the Status they had before it.
 */
export async function resolveExhaustedLoop(db: Db, runId: string, action: "retry" | "continue" | "stop", opts: { projects?: ProjectsPort | undefined } = {}) {
  const stuck = await stuckLoop(db, runId);
  if (!stuck) throw new Error("This run was not stopped by a loop that ran out of attempts.");
  if (action === "stop") return cancelRun(db, runId, { reason: `stopped after ${stuck.edgeKey} ran out of attempts`, projects: opts.projects });
  await db.transaction(async (tx) => {
    const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).for("update");
    const graph = await loadCompiledGraph(tx, run!.graphVersionId);
    const out = graph.outEdges(stuck.nodeKey);
    const edges = action === "retry" ? out.filter((e) => e.key === stuck.edgeKey) : out.filter((e) => !e.loop);
    if (edges.length === 0) throw new Error(action === "retry" ? `The graph no longer has ${stuck.edgeKey}.` : `${stuck.nodeKey} has no way forward other than its loops.`);
    // Another round counts as the loop's first attempt again.
    const current = run!.state as RunState;
    const state = action === "retry" ? { ...current, loops: { ...current.loops, [stuck.edgeKey]: { attempts: 1 } } } : current;
    const created = [];
    for (const edge of edges) {
      const exec = await createExecution(tx, graph, runId, edge.target, { kind: "edge", edgeKey: edge.key, from: stuck.nodeKey, fromExecutionId: stuck.executionId });
      created.push({ type: "node.created", payload: { nodeKey: edge.target, attempt: exec.attempt, via: edge.key }, nodeExecutionId: exec.id });
    }
    await tx.update(runs).set({ status: "running", finishedAt: null, state, stateVersion: sql`${runs.stateVersion} + 1` }).where(eq(runs.id, runId));
    // The stuck loop held the project's scheduler.
    await nudgeScheduler(tx, run!.projectId);
    await appendEvents(tx, runId, [{ type: "loop.resolved", payload: { action, edgeKey: stuck.edgeKey, nodeKey: stuck.nodeKey }, nodeExecutionId: stuck.executionId }, ...created]);
  });
}

export { mergeQueue, requestMerge, requestMergeAll, type QueueEntry } from "./merge-queue.ts";
