import { expect, test } from "vitest";
import { kindOf } from "./kinds.ts";

test("kindOf prefers the label, then the issue type, then depth, and is undefined past three levels", () => {
  // The label wins over the issue type and the depth.
  expect(kindOf(["bug", "story"], "Epic", 2)).toBe("story");
  // Without a kind label, an issue type named like a kind decides, whatever its case.
  expect(kindOf(["bug"], "Task", 0)).toBe("task");
  // An issue type that is not a kind (GitHub's default Bug, Feature) falls through to depth.
  expect(kindOf([], "Bug", 1)).toBe("story");
  // Depth alone: no parent is an epic, one parent a story, two parents a task.
  expect(kindOf([], undefined, 0)).toBe("epic");
  expect(kindOf([], null, 1)).toBe("story");
  expect(kindOf([], undefined, 2)).toBe("task");
  // Nested deeper than three levels, depth says nothing.
  expect(kindOf([], undefined, 3)).toBeUndefined();
  expect(kindOf([], undefined, 5)).toBeUndefined();
  // A label still names the kind of a deep issue.
  expect(kindOf(["Task"], undefined, 4)).toBe("task");
});
