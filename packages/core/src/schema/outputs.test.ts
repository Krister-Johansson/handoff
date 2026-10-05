import { expect, test } from "vitest";
import { CoderOutputSchema, PlannerOutputSchema, ReviewerOutputSchema } from "./outputs.ts";

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

test("answers accept fixed with a commit, declined with evidence and duplicate with of", () => {
  const answers = [
    { id: "R1", verdict: "fixed", evidence: "The test in src/a.test.ts failed before the change.", commit: "94c0c6c" },
    { id: "R2", verdict: "declined", evidence: "`gh issue edit --help` lists --attach." },
    { id: "R3", verdict: "duplicate", evidence: "The note repeats the thread on vitest.config.ts.", of: "R1" },
  ];
  const output = CoderOutputSchema.parse({ status: "done", summary: "Answered three comments.", answers });
  expect(output.answers).toEqual(answers);
  expect(CoderOutputSchema.safeParse({ status: "done", summary: "s", answers: [{ id: "R1", verdict: "agreed", evidence: "e" }] }).success).toBe(false);
});
