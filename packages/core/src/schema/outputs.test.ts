import { expect, test } from "vitest";
import { PlannerOutputSchema, ReviewerOutputSchema } from "./outputs.ts";

test("a planner's split has at least two parts, each with a title, a body and its owned paths", () => {
  const part = (title: string) => ({ title, body: `Build ${title}.`, ownedPaths: [`src/${title}.ts`] });
  const split = { status: "split", plan: "Too big for one run.", steps: [], ownedPaths: [], parts: [part("board"), part("drag")] };
  expect(PlannerOutputSchema.parse(split).parts?.map((p) => p.title)).toEqual(["board", "drag"]);
  expect(PlannerOutputSchema.safeParse({ ...split, parts: [part("board")] }).success).toBe(false);
  expect(PlannerOutputSchema.safeParse({ ...split, parts: undefined }).success).toBe(false);
  expect(PlannerOutputSchema.safeParse({ ...split, parts: [part("board"), { title: "drag", body: "", ownedPaths: [] }] }).success).toBe(false);
});

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
