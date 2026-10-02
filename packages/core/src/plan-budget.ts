/** The most files and steps a plan may have before its planner proposes a split. */
export type PlanBudget = { files: number; steps: number };

/** A project's plan budget when it sets none. */
export const DEFAULT_PLAN_BUDGET: PlanBudget = { files: 15, steps: 12 };

/** A project's plan budget: its own setting, or the defaults for what it leaves out. */
export function planBudgetOf(setting: Partial<PlanBudget> | null | undefined): PlanBudget {
  return { files: setting?.files ?? DEFAULT_PLAN_BUDGET.files, steps: setting?.steps ?? DEFAULT_PLAN_BUDGET.steps };
}
