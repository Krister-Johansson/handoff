import { and, eq, projectSchedulers, sql, wakeByKey, type DbExecutor } from "@handoff/db";

/** The key a scheduler-started run waits on before its coder while its plan shares paths with another active run. */
export const overlapKey = (projectId: string) => `overlap:${projectId}`;

/**
 * Brings a project's next scheduler check forward after something that can make a task startable or
 * clear a hold: a run ends, a merge closes issues, a person answers or decides. A burst of nudges
 * costs one check, since the check never comes closer than 10 seconds after the last one. Given a
 * transaction, the nudge commits with what caused it. Does nothing while the scheduler is off.
 */
export async function nudgeScheduler(db: DbExecutor, projectId: string): Promise<void> {
  await db
    .update(projectSchedulers)
    .set({
      nextCheckAt: sql`least(${projectSchedulers.nextCheckAt}, greatest(now(), coalesce(${projectSchedulers.lastCheckAt} + interval '10 seconds', now())))`,
    })
    .where(and(eq(projectSchedulers.projectId, projectId), eq(projectSchedulers.enabled, true)));
}

/** Lets the project's runs held on overlap check again, after a run ended or a merge landed. */
export async function wakeOverlapHeld(db: DbExecutor, projectId: string): Promise<void> {
  await wakeByKey(db, overlapKey(projectId), { reason: "overlap" });
}
