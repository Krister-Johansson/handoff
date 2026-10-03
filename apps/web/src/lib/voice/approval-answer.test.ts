import { expect, test } from "vitest";
import { approvalAnswer } from "./approval-answer";

test("a spoken answer is yes, no with the rest as the note, or neither", () => {
  expect(approvalAnswer("Yes.")).toEqual({ approve: true });
  expect(approvalAnswer("go ahead")).toEqual({ approve: true });
  expect(approvalAnswer("Confirm.")).toEqual({ approve: true });
  expect(approvalAnswer("No, let it finish.")).toEqual({ approve: false, note: "let it finish" });
  expect(approvalAnswer("deny")).toEqual({ approve: false });
  expect(approvalAnswer("maybe later")).toBeUndefined();
  expect(approvalAnswer("nobody knows")).toBeUndefined();
});
