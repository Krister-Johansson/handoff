import { expect, test } from "vitest";
import { reviewOf } from "./human-gate.ts";

test("a plan under review shows the acceptance criteria the planner wrote, for the person to approve with it", () => {
  const { kind, markdown } = reviewOf("planner", { plan: "Add a board.", steps: ["Add the route"], ownedPaths: ["src/**"], acceptance: ["A user can create a new task", "Tasks persist"] });
  expect(kind).toBe("plan");
  expect(markdown).toContain("## Acceptance criteria\n\n- A user can create a new task\n- Tasks persist");
});

test("a review at a gate shows each finding's severity", () => {
  const { markdown } = reviewOf("reviewer", {
    verdict: "request_changes",
    comments: [
      { path: "plan", body: "No step adds the route.", severity: "blocking" },
      { path: "plan", body: "Name the test file.", severity: "follow_up" },
    ],
  });
  expect(markdown).toContain("- **Blocking** `plan` No step adds the route.");
  expect(markdown).toContain("- **Follow-up** `plan` Name the test file.");
});
