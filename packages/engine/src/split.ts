import { and, asc, eq, events, nodeExecutions, runs, sql, type DbExecutor } from "@handoff/db";
import { RunStateSchema, type SplitOf } from "@handoff/core";

/** The issues a `run.split` event lists as the later parts, and the run's issue it split, when it recorded one. */
type SplitPayload = { issue?: number; issues?: { number: number }[] };

/**
 * Which issue the run split and into which parts, from its `run.split` events: for a run split before
 * runs kept `splitOf` in their state. The split issue is the one the event names, else the run's first
 * issue, which a split never drops. Undefined for a run that never split, or that split a task with no issue.
 */
export async function splitOfEvents(db: DbExecutor, run: { id: string; issues: { number: number }[] }): Promise<SplitOf | undefined> {
  const rows = await db
    .select({ payload: events.payload })
    .from(events)
    .where(and(eq(events.runId, run.id), eq(events.type, "run.split")))
    .orderBy(asc(events.seq));
  if (rows.length === 0) return undefined;
  const payloads = rows.map((r) => r.payload as SplitPayload);
  const issue = payloads.find((p) => p.issue !== undefined)?.issue ?? run.issues[0]?.number;
  if (issue === undefined) return undefined;
  return { issue, parts: [...new Set(payloads.flatMap((p) => (p.issues ?? []).map((i) => i.number)))] };
}

/** The run's split: from its state, else from its `run.split` events. */
export async function splitOfRun(db: DbExecutor, run: { id: string; issues: { number: number }[]; state: unknown }): Promise<SplitOf | undefined> {
  return RunStateSchema.parse(run.state).splitOf ?? (await splitOfEvents(db, run));
}

/** A split that lists an issue among its parts: the run that split, and what it split into. */
export type SplitGroup = SplitOf & { runId: string };

/** The splits of the project's runs that list `part` among their parts. */
export async function splitsWithPart(db: DbExecutor, projectId: string, part: number): Promise<SplitGroup[]> {
  const found = await db
    .selectDistinct({ id: runs.id, issues: runs.issues, state: runs.state })
    .from(events)
    .innerJoin(runs, eq(runs.id, events.runId))
    .where(and(eq(runs.projectId, projectId), eq(events.type, "run.split"), sql`${events.payload}->'issues' @> ${JSON.stringify([{ number: part }])}::jsonb`));
  const groups: SplitGroup[] = [];
  for (const run of found) {
    const split = await splitOfRun(db, run);
    if (split?.parts.includes(part)) groups.push({ ...split, runId: run.id });
  }
  return groups;
}

/** Whether the run's merge step merged its pull request, or found it merged. */
export async function recordedMerge(db: DbExecutor, runId: string): Promise<boolean> {
  const [event] = await db.select({ seq: events.seq }).from(events).where(and(eq(events.runId, runId), eq(events.type, "github.merged"))).limit(1);
  if (event) return true;
  const [step] = await db
    .select({ id: nodeExecutions.id })
    .from(nodeExecutions)
    .where(and(eq(nodeExecutions.runId, runId), eq(nodeExecutions.status, "passed"), sql`${nodeExecutions.output}->>'merged' = 'true'`))
    .limit(1);
  return step !== undefined;
}

/**
 * Whether part 1 of the run's split merged: by the run itself, or by a run that took its place when a
 * person ran it again, following the runs that superseded it.
 */
export async function partOneMerged(db: DbExecutor, runId: string): Promise<boolean> {
  const seen = new Set<string>();
  for (let id: string | null = runId; id && !seen.has(id); ) {
    seen.add(id);
    if (await recordedMerge(db, id)) return true;
    const [row] = await db.select({ next: runs.supersededBy }).from(runs).where(eq(runs.id, id));
    id = row?.next ?? null;
  }
  return false;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A pull request description that does not close the issue when it merges. Its lines that only close the
 * issue, such as "Closes #4" or "Fixes #4", go. Anywhere else, GitHub reads a closing keyword (close,
 * closes, closed, fix, fixes, fixed, resolve, resolves, resolved, in any case, with an optional colon) in
 * front of a reference to the issue (#4, owner/repo#4 or the issue's URL) as closing it, even in prose
 * such as "It does not close #4", so "issue" goes between them: "It does not close issue #4".
 */
export function withoutClosing(body: string, issue: number, repo: { owner: string; name: string }): string {
  const keyword = "\\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)(:?)";
  const slug = `${escape(repo.owner)}/${escape(repo.name)}`;
  const reference = `(?:#|${slug}#|https?://github\\.com/${slug}/issues/)${issue}(?!\\d)`;
  const line = new RegExp(`^[ \\t]*${keyword}[ \\t]+${reference}[ \\t]*\\.?[ \\t]*(\\r?\\n|$)`, "gim");
  const phrase = new RegExp(`${keyword}(\\s+)(?=${reference})`, "gi");
  return body.replace(line, "").replace(phrase, (_, word: string, colon: string, space: string) => `${word}${colon}${space}issue `);
}

/** The line a pull request of a split run names the split issue with, which does not close it. */
export const partOfLine = (issue: number) => `Part of #${issue}`;
