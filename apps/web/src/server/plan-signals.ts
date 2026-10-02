import { and, asc, events, inArray, type Db } from "@handoff/db";
import { summarizeEvent } from "../lib/event-summary";
import { listInbox } from "./inbox";
import { allPendingPermissions } from "./permissions";

export type PlanSignals = {
  /** The project's runs that wait on a person: an open question, a permission request or a failed step. */
  needsYou: string[];
  /** Per task, why the latest status write of its latest run was skipped, when it was. */
  skipped: Record<number, string>;
};

/**
 * What the Plan page shows next to each task beyond GitHub's own data: whether its run needs the
 * person, and a status write handoff had to skip (a plan.skipped event the run recorded after its
 * last plan.status for that issue).
 */
export async function planSignals(db: Db, projectId: string, tasks: { number: number; run: { id: string } | null }[]): Promise<PlanSignals> {
  const runIds = [...new Set(tasks.flatMap((t) => (t.run ? [t.run.id] : [])))];
  const [inbox, permissions, planEvents] = await Promise.all([
    listInbox(db),
    allPendingPermissions(db),
    runIds.length
      ? db
          .select({ runId: events.runId, type: events.type, payload: events.payload })
          .from(events)
          .where(and(inArray(events.runId, runIds), inArray(events.type, ["plan.status", "plan.skipped"])))
          .orderBy(asc(events.runId), asc(events.seq))
      : Promise.resolve([]),
  ]);
  const ours = (r: { projectId: string }) => r.projectId === projectId;
  const needsYou = new Set([...inbox.questions.filter(ours), ...inbox.failedRuns.filter(ours), ...permissions.filter(ours)].map((r) => r.runId));

  const latest = new Map<string, (typeof planEvents)[number]>();
  for (const event of planEvents) {
    const issue = (event.payload as { issue?: unknown }).issue;
    if (typeof issue === "number") latest.set(`${event.runId}:${issue}`, event);
  }
  const skipped: Record<number, string> = {};
  for (const task of tasks) {
    const event = task.run && latest.get(`${task.run.id}:${task.number}`);
    if (event?.type === "plan.skipped") skipped[task.number] = summarizeEvent(event);
  }
  return { needsYou: [...needsYou], skipped };
}
