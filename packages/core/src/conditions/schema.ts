import { z } from "zod";

/** A dotted path rooted at the run state, the finished node, or the edge being evaluated. */
export const PathSchema = z.string().regex(/^(state|node|edge)(\.[^.]+)+$/, "path must start with state., node. or edge.");
export type Path = z.infer<typeof PathSchema>;

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
const JsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonSchema), z.record(z.string(), JsonSchema)]),
);

export type Condition =
  | { always: true }
  | { eq: [Path, Json] }
  | { neq: [Path, Json] }
  | { gt: [Path, number] }
  | { gte: [Path, number] }
  | { lt: [Path, number] }
  | { lte: [Path, number] }
  | { in: [Path, Json[]] }
  | { exists: Path }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

const cmp = z.tuple([PathSchema, z.number()]);

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ always: z.literal(true) }),
    z.strictObject({ eq: z.tuple([PathSchema, JsonSchema]) }),
    z.strictObject({ neq: z.tuple([PathSchema, JsonSchema]) }),
    z.strictObject({ gt: cmp }),
    z.strictObject({ gte: cmp }),
    z.strictObject({ lt: cmp }),
    z.strictObject({ lte: cmp }),
    z.strictObject({ in: z.tuple([PathSchema, z.array(JsonSchema)]) }),
    z.strictObject({ exists: PathSchema }),
    z.strictObject({ all: z.array(ConditionSchema) }),
    z.strictObject({ any: z.array(ConditionSchema) }),
    z.strictObject({ not: ConditionSchema }),
  ]),
);
