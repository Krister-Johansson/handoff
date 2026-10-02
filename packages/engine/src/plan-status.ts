import { appendEvents, type Db } from "@handoff/db";
import type { PlanStatus, ProjectsPort } from "@handoff/github";

/**
 * A run event that says what a status write on the plan did: set, or skipped with the reason. A run that
 * moves a task onto its own Status (Running at its start, or the run's Status when the task joins the plan
 * during the run) records the Status the task had in `from`, which cancelling the run puts back.
 */
export type PlanEvent =
  | { type: "plan.status"; payload: { issue: number; status: PlanStatus; from?: PlanStatus } }
  | { type: "plan.skipped"; payload: { issue: number; status: PlanStatus; reason: string } };

type PlannedProject = { repoOwner: string; repoName: string; planProjectNumber: number | null };

/** The Status each issue had before a write, by issue number; an issue without one records no `from`. */
export type StatusesBefore = ReadonlyMap<number, PlanStatus | undefined>;

/**
 * Sets Status on the plan for each issue, one event per issue. A project without a plan gets no
 * writes and no events. A write that cannot happen (no Projects access, an issue outside the
 * Project, a missing option, an error from GitHub) becomes plan.skipped and never throws, so a
 * status write never fails a run. `from` gives the Status each issue had, recorded on its plan.status.
 */
export async function writePlanStatus(
  projects: ProjectsPort | undefined,
  project: PlannedProject,
  issues: number[],
  status: PlanStatus,
  from?: StatusesBefore,
): Promise<PlanEvent[]> {
  const number = project.planProjectNumber;
  if (number === null || issues.length === 0) return [];
  const repo = { owner: project.repoOwner, name: project.repoName };
  return Promise.all(
    issues.map(async (issue): Promise<PlanEvent> => {
      const skipped = (reason: string): PlanEvent => ({ type: "plan.skipped", payload: { issue, status, reason } });
      if (!projects) return skipped("no-access");
      try {
        const result = await projects.setStatus(repo, number, issue, status);
        const before = from?.get(issue);
        return result === "set" ? { type: "plan.status", payload: { issue, status, ...(before ? { from: before } : {}) } } : skipped(result);
      } catch (error) {
        return skipped(error instanceof Error ? error.message : String(error));
      }
    }),
  );
}

/**
 * writePlanStatus for a run outside a step (its start, its cancel, its task joining a plan), with the
 * events appended to the run. Returns the events.
 */
export async function recordPlanStatus(
  db: Db,
  runId: string,
  projects: ProjectsPort | undefined,
  project: PlannedProject,
  issues: number[],
  status: PlanStatus,
  from?: StatusesBefore,
): Promise<PlanEvent[]> {
  const written = await writePlanStatus(projects, project, issues, status, from);
  if (written.length) await db.transaction((tx) => appendEvents(tx, runId, written));
  return written;
}
