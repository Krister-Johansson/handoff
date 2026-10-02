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
export type FieldWrite = { key: PlanFieldKey; fieldId: string; value: string | number | null };

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
  const out = newDocument(["$projectId: ID!", "$itemId: ID!"]);
  addFieldMutations(out, writes, "", "itemId");
  return { document: `mutation SetPlanFields(${out.declarations.join(", ")}) {\n${out.selections.join("\n")}\n}`, variables: out.variables };
}

/**
 * One mutation request for several items' writes, built as `setPlanFieldsDocument` builds one item's:
 * each item's id in `$i<issue>Item`, its mutations aliased `i<issue>_<key>` with the variables
 * `i<issue>_<key>Field` and `i<issue>_<key>Value`. The caller adds the variable projectId.
 */
export function setManyPlanFieldsDocument(items: { issue: number; itemId: string; writes: FieldWrite[] }[]): { document: string; variables: Record<string, unknown> } {
  const out = newDocument(["$projectId: ID!"]);
  for (const { issue, itemId, writes } of items) {
    out.declarations.push(`$i${issue}Item: ID!`);
    out.variables[`i${issue}Item`] = itemId;
    addFieldMutations(out, writes, `i${issue}_`, `i${issue}Item`);
  }
  return { document: `mutation SetManyPlanFields(${out.declarations.join(", ")}) {\n${out.selections.join("\n")}\n}`, variables: out.variables };
}

/**
 * One query for the Project items of several issues of a repository: each issue aliased `i<issue>`,
 * its number in the variable of that name, with the id and Project id of each of its items. The
 * caller adds the variables owner and name.
 */
export function planItemIdsDocument(issues: number[]): { document: string; variables: Record<string, unknown> } {
  const declarations = ["$owner: String!", "$name: String!", ...issues.map((n) => `$i${n}: Int!`)];
  const selections = issues.map((n) => `    i${n}: issue(number: $i${n}) { projectItems(first: 20) { nodes { id project { id } } } }`);
  return {
    document: `query PlanItemIds(${declarations.join(", ")}) {\n  repository(owner: $owner, name: $name) {\n${selections.join("\n")}\n  }\n}`,
    variables: Object.fromEntries(issues.map((n) => [`i${n}`, n])),
  };
}

type DocumentParts = { declarations: string[]; selections: string[]; variables: Record<string, unknown> };
const newDocument = (declarations: string[]): DocumentParts => ({ declarations, selections: [], variables: {} });

/** Adds a mutation per write on the item in `$<itemVariable>`, aliased `<prefix><key>` with the variables `<prefix><key>Field` and `<prefix><key>Value`. */
function addFieldMutations(out: DocumentParts, writes: FieldWrite[], prefix: string, itemVariable: string) {
  for (const { key, fieldId, value } of writes) {
    const name = `${prefix}${key}`;
    const target = `projectId: $projectId, itemId: $${itemVariable}, fieldId: $${name}Field`;
    out.declarations.push(`$${name}Field: ID!`);
    out.variables[`${name}Field`] = fieldId;
    if (value === null) {
      out.selections.push(`  ${name}: clearProjectV2ItemFieldValue(input: { ${target} }) { projectV2Item { id } }`);
    } else {
      out.declarations.push(`$${name}Value: ${VALUE_OF[key].type}!`);
      out.variables[`${name}Value`] = value;
      out.selections.push(`  ${name}: updateProjectV2ItemFieldValue(input: { ${target}, value: { ${VALUE_OF[key].key}: $${name}Value } }) { projectV2Item { id } }`);
    }
  }
}
