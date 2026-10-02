import { expect, test } from "vitest";
import { initialRunState, mergeState, RunStateSchema } from "./run-state.ts";

test("mergeState records the node result and applies the patch without dropping earlier nodes", () => {
  const s1 = mergeState(initialRunState("t"), "planner", { output: { plan: "p" }, executionId: "e1", attempt: 1 }, {
    plan: { plan: "p", steps: [], ownedPaths: ["src"] },
  });
  const s2 = mergeState(s1, "coder", { output: { status: "done" }, executionId: "e2", attempt: 1 });
  expect(Object.keys(s2.nodes)).toEqual(["planner", "coder"]);
  expect(s2.plan?.ownedPaths).toEqual(["src"]);
  expect(s2.task).toBe("t");
});

test("a plan may carry a size of S, M or L and nothing else", () => {
  const withPlan = (plan: Record<string, unknown>) => RunStateSchema.safeParse({ ...initialRunState("t"), plan: { plan: "p", steps: ["a"], ownedPaths: ["src"], ...plan } });
  for (const size of ["S", "M", "L"]) expect(withPlan({ size }).data?.plan?.size).toBe(size);
  // A plan from before planners proposed a size validates unchanged.
  expect(withPlan({}).data?.plan).toEqual({ plan: "p", steps: ["a"], ownedPaths: ["src"] });
  for (const size of ["XL", "m", "🐂 Medium", 2]) expect(withPlan({ size }).success).toBe(false);
});
