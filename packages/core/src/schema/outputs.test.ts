import { expect, test } from "vitest";
import { ReviewerOutputSchema } from "./outputs.ts";

test("a comment without severity reads as should_fix", () => {
  const output = ReviewerOutputSchema.parse({
    verdict: "approve",
    comments: [
      { path: "src/a.ts", line: 3, body: "Name the constant." },
      { path: "src/b.ts", body: "Crashes on an empty list.", severity: "blocking" },
    ],
  });
  expect(output.comments.map((c) => c.severity)).toEqual(["should_fix", "blocking"]);
});
