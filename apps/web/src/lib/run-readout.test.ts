import { expect, test } from "vitest";
import { runReadout } from "./run-readout";

test("a run reads as its task, its status, each step's latest state and the latest failure", () => {
  const text = runReadout({
    task: "Add a CHANGELOG.md",
    status: "running",
    executions: [
      { nodeKey: "planner-1", attempt: 1, status: "passed" },
      { nodeKey: "coder-1", attempt: 1, status: "failed", error: { code: "contract", message: "tests did not pass" } },
      { nodeKey: "coder-1", attempt: 2, status: "running" },
    ],
  });
  expect(text).toBe("Add a CHANGELOG.md. The run is running. Steps: planner-1 passed, coder-1 running. The latest failure: coder-1 attempt 1, tests did not pass.");
});

test("a finished run with no failure reads without one", () => {
  expect(runReadout({ task: "Fix the README", status: "succeeded", executions: [{ nodeKey: "coder-1", attempt: 1, status: "passed" }] })).toBe(
    "Fix the README. The run succeeded. Steps: coder-1 passed.",
  );
});
