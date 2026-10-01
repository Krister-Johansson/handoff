import { expect, test } from "vitest";
import { reviewOf } from "./human-gate.ts";

test("a plan under review shows the acceptance criteria the planner wrote, for the person to approve with it", () => {
  const { kind, markdown } = reviewOf("planner", { plan: "Add a board.", steps: ["Add the route"], ownedPaths: ["src/**"], acceptance: ["A user can create a new task", "Tasks persist"] });
  expect(kind).toBe("plan");
  expect(markdown).toContain("## Acceptance criteria\n\n- A user can create a new task\n- Tasks persist");
});
