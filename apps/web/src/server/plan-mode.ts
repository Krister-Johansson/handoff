import { eq, PLAN_MODES, projects, type Db, type PlanMode } from "@handoff/db";
import { planUiTool, UiToolError } from "../lib/assistant/ui-tools";

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

/** A project as a mode check reads it. */
type ModeOf = { name: string; planMode: PlanMode };

/**
 * The sentences a tool for the other mode refuses with (docs/plans/flow.md, Decision 2), each naming the mode
 * and what to use instead.
 */
export const MODE_REFUSALS = {
  /** schedule, Arrange by estimate and other date writes in a Flow project. */
  dates: (p: ModeOf) => `${p.name} plans in Flow mode: tasks have an order and blockers, no dates. Use arrange_plan and set_order, or a person can switch the plan mode in Project settings.`,
  /** Adding the Start and Target fields to a Flow project's GitHub Project. */
  dateFields: (p: ModeOf) => `${p.name} plans in Flow mode, which has no dates. Its Project needs no Start or Target field.`,
  /** Start and Target on a new story or task in a Flow project. */
  newDates: (p: ModeOf) => `${p.name} plans in Flow mode, which has no dates. Leave start and target out; set_order places the task.`,
  /** An estimate in hours in a Flow project. */
  estimate: (p: ModeOf) => `${p.name} plans in Flow mode, which has no hours. Set a size with set_size instead: S, M or L.`,
  /** An order write in a Timeline project. */
  order: (p: ModeOf) => `${p.name} plans in Timeline mode: order work with dates through arrange_plan and schedule.`,
} as const;

/**
 * Throws `sentence`, one of MODE_REFUSALS, when the project plans in `mode`. Every write that belongs to the
 * other mode calls it before it writes to GitHub, so a refusal changes nothing.
 */
export function refuseInMode(project: ModeOf, mode: PlanMode, sentence: (p: ModeOf) => string): void {
  if (project.planMode === mode) throw new Error(sentence(project));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Why a go_to_plan call asks for the other plan mode's view, read from the project on the server, since the
 * person's browser does not know the project's mode; undefined for any other call, which the page runs as it is.
 */
export async function planViewRefusal(db: Db, name: string, args: unknown): Promise<string | undefined> {
  const projectId = (args as { project_id?: unknown } | undefined)?.project_id;
  if (name !== "go_to_plan" || typeof projectId !== "string" || !UUID.test(projectId)) return undefined;
  const [project] = await db.select({ name: projects.name, planMode: projects.planMode }).from(projects).where(eq(projects.id, projectId));
  if (!project) return undefined;
  try {
    planUiTool(name, args, "http://localhost", { project });
    return undefined;
  } catch (error) {
    return error instanceof UiToolError ? error.message : undefined;
  }
}
