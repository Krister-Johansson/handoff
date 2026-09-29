import type { Condition, Json } from "./schema.ts";

export type ConditionContext = {
  state: unknown;
  node: { key: string; status: string; attempt: number; output?: unknown; checks?: unknown };
  edge: { key: string; maxAttempts?: number | undefined };
};

const MISSING = Symbol("missing");

function resolve(path: string, ctx: ConditionContext): unknown {
  const [root, ...segments] = path.split(".");
  let value: unknown = (ctx as Record<string, unknown>)[root as string];
  for (const segment of segments) {
    if (value === null || typeof value !== "object" || !(segment in value)) return MISSING;
    value = (value as Record<string, unknown>)[segment];
  }
  return value === undefined ? MISSING : value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function numeric(path: string, ctx: ConditionContext, test: (v: number) => boolean): boolean {
  const v = resolve(path, ctx);
  return typeof v === "number" && test(v);
}

export function evaluateCondition(condition: Condition, ctx: ConditionContext): boolean {
  if ("always" in condition) return true;
  if ("eq" in condition) {
    const v = resolve(condition.eq[0], ctx);
    return v !== MISSING && deepEqual(v, condition.eq[1]);
  }
  if ("neq" in condition) {
    const v = resolve(condition.neq[0], ctx);
    return v === MISSING || !deepEqual(v, condition.neq[1]);
  }
  if ("gt" in condition) return numeric(condition.gt[0], ctx, (v) => v > condition.gt[1]);
  if ("gte" in condition) return numeric(condition.gte[0], ctx, (v) => v >= condition.gte[1]);
  if ("lt" in condition) return numeric(condition.lt[0], ctx, (v) => v < condition.lt[1]);
  if ("lte" in condition) return numeric(condition.lte[0], ctx, (v) => v <= condition.lte[1]);
  if ("in" in condition) {
    const v = resolve(condition.in[0], ctx);
    return v !== MISSING && condition.in[1].some((option: Json) => deepEqual(v, option));
  }
  if ("exists" in condition) return resolve(condition.exists, ctx) !== MISSING;
  if ("all" in condition) return condition.all.every((c) => evaluateCondition(c, ctx));
  if ("any" in condition) return condition.any.some((c) => evaluateCondition(c, ctx));
  return !evaluateCondition(condition.not, ctx);
}
