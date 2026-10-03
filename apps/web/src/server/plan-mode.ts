import { eq, PLAN_MODES, projects, type Db, type PlanMode } from "@handoff/db";

export { PLAN_MODES, type PlanMode };

/** How a project plans its work, Flow or Timeline. */
export async function planModeOf(db: Db, projectId: string): Promise<PlanMode> {
  const [row] = await db.select({ planMode: projects.planMode }).from(projects).where(eq(projects.id, projectId));
  if (!row) throw new Error("The project no longer exists.");
  return row.planMode;
}

/**
 * Saves a project's plan mode. Only a person changes it, in Project settings. Switching writes nothing to
 * GitHub: Start, Target and Estimate stay on the items, and Project order stays as it is.
 */
export async function setPlanMode(db: Db, projectId: string, mode: PlanMode) {
  if (!(PLAN_MODES as readonly string[]).includes(mode)) throw new Error("The plan mode is Flow or Timeline.");
  const [row] = await db.update(projects).set({ planMode: mode, updatedAt: new Date() }).where(eq(projects.id, projectId)).returning({ id: projects.id });
  if (!row) throw new Error("The project no longer exists.");
}
