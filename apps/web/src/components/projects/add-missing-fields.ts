import { addDateFieldsAction, addEstimateFieldsAction } from "@/app/projects/actions";
import { missingFields, type PlanFieldsPresent } from "@/lib/plan/plan-fields";
import type { PlanModeName } from "@/lib/project-tab";

/** What adding the fields came to: ok, or the first refusal's sentence. */
export type AddFieldsResult = { ok?: boolean; error?: string };

/**
 * Add the fields: creates the fields the plan mode reads that the Project lacks. In Timeline the Start and Target
 * date fields and Size and Estimate; in Flow, Size only, as setup_plan does. `picked` is a mode a person picked in
 * Plan mode and has not saved yet, so the actions add the fields for it instead of the stored mode.
 */
export async function addMissingFields(projectId: string, mode: PlanModeName, fields: PlanFieldsPresent, picked = false): Promise<AddFieldsResult> {
  const missing = missingFields(fields, mode);
  const input = picked ? { projectId, mode } : { projectId };
  const dates = missing.includes("Start") || missing.includes("Target");
  const estimates = missing.includes("Size") || missing.includes("Estimate");
  const results = [...(dates ? [await addDateFieldsAction(input)] : []), ...(estimates ? [await addEstimateFieldsAction(input)] : [])];
  return results.find((r) => r.error) ?? { ok: true };
}
