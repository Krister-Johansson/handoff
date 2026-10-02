import type { PlanDateFieldIds, PlanEstimateFieldIds, PlanFields, SetFieldsResult } from "./types.ts";

/** The fields `setPlanFields` writes, in the order it sends them. */
const PLAN_FIELD_KEYS = ["start", "target", "size", "estimate"] as const;
type PlanFieldKey = (typeof PLAN_FIELD_KEYS)[number];

/** Each field's key in `ProjectV2FieldValue` and the GraphQL type of its value. */
const VALUE_OF: Record<PlanFieldKey, { key: string; type: string }> = {
  start: { key: "date", type: "Date" },
  target: { key: "date", type: "Date" },
  size: { key: "singleSelectOptionId", type: "String" },
  estimate: { key: "number", type: "Float" },
};

/** One field to write on an item: its field id and the value, or null to clear it. */
type FieldWrite = { key: PlanFieldKey; fieldId: string; value: string | number | null };

/**
 * The writes for `fields` on a Project with these field ids, checking every field and Size option
 * first: "no-field" when the Project lacks a field to write, "no-option" when its Size field lacks the size.
 */
export function planFieldWrites(ids: { dates: PlanDateFieldIds; estimates: PlanEstimateFieldIds }, fields: PlanFields): FieldWrite[] | Exclude<SetFieldsResult, "set" | "not-in-project"> {
  const fieldIds: Record<PlanFieldKey, string | undefined> = { start: ids.dates.start, target: ids.dates.target, size: ids.estimates.size?.id, estimate: ids.estimates.estimate };
  const writes: FieldWrite[] = [];
  for (const key of PLAN_FIELD_KEYS) {
    const value = fields[key];
    if (value === undefined) continue;
    const fieldId = fieldIds[key];
    if (!fieldId) return "no-field";
    if (key === "size" && value !== null) {
      const optionId = ids.estimates.size?.options[value as NonNullable<PlanFields["size"]>];
      if (!optionId) return "no-option";
      writes.push({ key, fieldId, value: optionId });
    } else writes.push({ key, fieldId, value });
  }
  return writes;
}

/**
 * One mutation request for an item's writes: an aliased `updateProjectV2ItemFieldValue` per value and
 * `clearProjectV2ItemFieldValue` per null, with the variables `<key>Field` and `<key>Value`. GitHub
 * updates one value per mutation, so each field is its own mutation in the same request.
 */
export function setPlanFieldsDocument(writes: FieldWrite[]): { document: string; variables: Record<string, unknown> } {
  const declarations = ["$projectId: ID!", "$itemId: ID!"];
  const selections: string[] = [];
  const variables: Record<string, unknown> = {};
  for (const { key, fieldId, value } of writes) {
    const target = `projectId: $projectId, itemId: $itemId, fieldId: $${key}Field`;
    declarations.push(`$${key}Field: ID!`);
    variables[`${key}Field`] = fieldId;
    if (value === null) {
      selections.push(`  ${key}: clearProjectV2ItemFieldValue(input: { ${target} }) { projectV2Item { id } }`);
    } else {
      declarations.push(`$${key}Value: ${VALUE_OF[key].type}!`);
      variables[`${key}Value`] = value;
      selections.push(`  ${key}: updateProjectV2ItemFieldValue(input: { ${target}, value: { ${VALUE_OF[key].key}: $${key}Value } }) { projectV2Item { id } }`);
    }
  }
  return { document: `mutation SetPlanFields(${declarations.join(", ")}) {\n${selections.join("\n")}\n}`, variables };
}
