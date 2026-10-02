import { and, asc, eq, isNull, projectSchedulers, sql } from "@handoff/db";
import { checkProject, type CheckDeps } from "./tick.ts";

export type LoopDeps = CheckDeps & { log?: ((message: string, detail?: unknown) => void) | undefined };

/**
 * Checks every project whose scheduler is on, not paused, due and not being checked elsewhere, one
 * at a time, oldest due first. Returns the projects it checked; one another worker took first is left out.
 */
export async function checkDueProjects(deps: LoopDeps): Promise<string[]> {
  const due = await deps.db
    .select({ projectId: projectSchedulers.projectId })
    .from(projectSchedulers)
    .where(
      and(
        eq(projectSchedulers.enabled, true),
        isNull(projectSchedulers.pausedAt),
        sql`${projectSchedulers.nextCheckAt} <= now()`,
        sql`(${projectSchedulers.leaseExpiresAt} is null or ${projectSchedulers.leaseExpiresAt} < now())`,
      ),
    )
    .orderBy(asc(projectSchedulers.nextCheckAt));
  const checked: string[] = [];
  for (const { projectId } of due) {
    try {
      if (await checkProject(deps, projectId)) checked.push(projectId);
    } catch (error) {
      // One project's trouble (the database blinked, say) does not stop the others; the next poll tries again.
      deps.log?.(`the scheduler could not check project ${projectId}`, error instanceof Error ? error.message : error);
    }
  }
  return checked;
}

/**
 * The worker's scheduler loop: every `pollMs` it checks the projects that are due. Stopping waits for
 * the check in progress, so a stopped loop leaves no lease behind.
 */
export function startBacklogScheduler(deps: LoopDeps, opts: { pollMs: number }): { stop(): Promise<void> } {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let pass: Promise<unknown> = Promise.resolve();
  const tick = () => {
    pass = checkDueProjects(deps)
      .catch((error: unknown) => deps.log?.("the scheduler could not look for due projects", error instanceof Error ? error.message : error))
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, opts.pollMs);
      });
  };
  tick();
  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await pass;
    },
  };
}
