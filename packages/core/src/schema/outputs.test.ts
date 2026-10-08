import { expect, test } from "vitest";
import { z } from "zod";
import { CoderOutputSchema, commitsOf, PlannerOutputSchema, ReviewerOutputSchema, splitCommits } from "./outputs.ts";

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

test("a fixed answer may name several commits, in commit separated by commas or spaces or in commits", () => {
  // Run fa26ae45 answered R3 fixed with commit "1e3ca42, 6892e36", and the check looked that up as one commit.
  expect(commitsOf({ commit: "1e3ca42, 6892e36" })).toEqual(["1e3ca42", "6892e36"]);
  expect(commitsOf({ commit: "1e3ca42 6892e36,a1b2c3d" })).toEqual(["1e3ca42", "6892e36", "a1b2c3d"]);
  expect(commitsOf({ commits: ["1e3ca42", "6892e36"] })).toEqual(["1e3ca42", "6892e36"]);
  expect(commitsOf({ commit: "1e3ca42", commits: ["6892e36", "1e3ca42"] })).toEqual(["1e3ca42", "6892e36"]);
  // An answer from before commits keeps its one commit.
  expect(commitsOf({ commit: "94c0c6c" })).toEqual(["94c0c6c"]);
  expect(commitsOf({})).toEqual([]);
  expect(commitsOf({ commit: " , " })).toEqual([]);
  expect(splitCommits("4e1a9c2d0b 9d03f5b1")).toEqual(["4e1a9c2d0b", "9d03f5b1"]);
  expect(splitCommits(null)).toEqual([]);

  const answer = { id: "R3", verdict: "fixed", evidence: "Both commits rename it.", commits: ["1e3ca42", "6892e36"] };
  expect(CoderOutputSchema.parse({ status: "done", summary: "s", answers: [answer] }).answers).toEqual([answer]);
  const schema = JSON.stringify(z.toJSONSchema(CoderOutputSchema, { target: "draft-7" }));
  expect(schema).toContain('"commits"');
});

test("the coder's JSON schema describes declined as not changed, with the reason and the evidence", () => {
  // On northMES/northmes#285 the coder declined an accurate claim as out of scope: declined is not only for a claim that is wrong.
  const schema = JSON.stringify(z.toJSONSchema(CoderOutputSchema, { target: "draft-7" }));
  expect(schema).toContain("declined: not changed, with the reason and the evidence, such as a claim that is wrong, out of scope or already covered.");
  expect(schema).not.toContain("the claim does not hold");
});
