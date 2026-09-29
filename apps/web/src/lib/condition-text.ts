import type { Condition } from "@handoff/core";

const short = (path: string) => path.split(".").slice(-2).filter((s) => !["node", "state", "output", "edge"].includes(s)).join(".") || path;
const lit = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/** One-line reading of an edge condition for labels. */
export function describeCondition(condition: Condition | undefined): string {
  if (!condition) return "";
  if ("always" in condition) return "always";
  if ("eq" in condition) return `${short(condition.eq[0])} = ${lit(condition.eq[1])}`;
  if ("neq" in condition) return `${short(condition.neq[0])} ≠ ${lit(condition.neq[1])}`;
  if ("gt" in condition) return `${short(condition.gt[0])} > ${condition.gt[1]}`;
  if ("gte" in condition) return `${short(condition.gte[0])} ≥ ${condition.gte[1]}`;
  if ("lt" in condition) return `${short(condition.lt[0])} < ${condition.lt[1]}`;
  if ("lte" in condition) return `${short(condition.lte[0])} ≤ ${condition.lte[1]}`;
  if ("in" in condition) return `${short(condition.in[0])} in ${condition.in[1].map(lit).join(", ")}`;
  if ("exists" in condition) return `${short(condition.exists)} exists`;
  if ("all" in condition) return condition.all.map(describeCondition).join(" and ");
  if ("any" in condition) return condition.any.map(describeCondition).join(" or ");
  return `not ${describeCondition(condition.not)}`;
}
