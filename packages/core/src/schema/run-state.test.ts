import { expect, test } from "vitest";
import { initialRunState, mergeState } from "./run-state.ts";

test("mergeState records the node result and applies the patch without dropping earlier nodes", () => {
  const s1 = mergeState(initialRunState("t"), "planner", { output: { plan: "p" }, executionId: "e1", attempt: 1 }, {
    plan: { plan: "p", steps: [], ownedPaths: ["src"] },
  });
  const s2 = mergeState(s1, "coder", { output: { status: "done" }, executionId: "e2", attempt: 1 });
  expect(Object.keys(s2.nodes)).toEqual(["planner", "coder"]);
  expect(s2.plan?.ownedPaths).toEqual(["src"]);
  expect(s2.task).toBe("t");
});
