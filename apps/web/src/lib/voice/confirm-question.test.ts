import { expect, test } from "vitest";
import { confirmQuestion } from "./confirm-question";

const ask = (name: string, args: unknown, summary = "") => confirmQuestion({ name, args, summary });

test("a confirmation card asks what the tool will do as a question", () => {
  expect(ask("page_submit", { option: "approve" })).toBe("Approve the try it?");
  expect(ask("page_submit", { option: "changes", note: "It shows only after a reload" })).toBe("Send the try it back to the coder?");
  expect(ask("page_submit_review", { option: "approve" })).toBe("Approve the review?");
  expect(ask("page_submit_review", { option: "changes" })).toBe("Send the review back with changes?");
  expect(ask("page_submit_review", { option: "fix" })).toBe("Approve the review after the fixes?");
  expect(ask("page_submit_review", { option: "split" })).toBe("Split the task as proposed?");
  expect(ask("page_restart_app", {})).toBe("Start the app again?");
  expect(ask("answer_permission", { request_id: "p1", decision: "allow" })).toBe("Allow the permission request once?");
  expect(ask("answer_permission", { request_id: "p1", decision: "deny", message: "use the limiter we have" })).toBe("Deny the permission request?");
  // Any other tool asks its summary.
  expect(ask("cancel_run", { run_id: "7f3a1b2c" }, "Cancel run 7f3a1b2c.")).toBe("Cancel run 7f3a1b2c?");
});
