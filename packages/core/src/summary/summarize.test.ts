import { expect, test } from "vitest";
import { summarizeOutput } from "./summarize.ts";

test("a plan is summarized by its first sentence and its step count", () => {
  expect(summarizeOutput({ plan: "Strip apostrophes before slugifying. Then add a test.", steps: ["a", "b", "c"], ownedPaths: [] })).toBe(
    "Strip apostrophes before slugifying. 3 steps",
  );
});

test("a Coder is summarized by its first sentence and the files it changed, or by its question", () => {
  expect(summarizeOutput({ status: "done", summary: "Removed apostrophes in slugify. Tests pass.", filesChanged: ["a.js", "b.js"] })).toBe(
    "Removed apostrophes in slugify. 2 files changed",
  );
  expect(summarizeOutput({ status: "needs_input", summary: "", question: { text: "Which license?" } })).toBe("Asked: Which license?");
});

test("a test run, a review, a pull request, a merge and an answer each get one line", () => {
  expect(summarizeOutput({ passed: true, command: "npm test", exitCode: 0, tail: "" })).toBe("npm test passed");
  expect(summarizeOutput({ passed: false, command: "npm test", exitCode: 1, tail: "" })).toBe("npm test failed, exit 1");
  expect(summarizeOutput({ verdict: "approve", comments: [{ path: "a", body: "nit" }] })).toBe("Approved with 1 comment");
  expect(summarizeOutput({ verdict: "request_changes", comments: [{ path: "a", body: "x" }, { path: "b", body: "y" }] })).toBe("Requested changes, 2 comments");
  expect(
    summarizeOutput({
      prNumber: 10,
      prUrl: "u",
      headSha: "abc",
      feedback: { ci: { status: "success", failedJobs: [] }, review: { decision: "approved", comments: [], unresolvedThreads: 0 }, updatedAt: "" },
    }),
  ).toBe("PR #10, CI passing, approved");
  expect(summarizeOutput({ merged: true, sha: "07dc1569861d" })).toBe("Merged as 07dc156");
  expect(summarizeOutput({ sync: "conflict", conflict: { base: "main", baseSha: "abc", files: ["package.json", "README.md"] } })).toBe(
    "Conflicts with main in 2 files: package.json, README.md",
  );
  expect(summarizeOutput({ merged: false, needsUpdate: true })).toBe("Conflicts with main, sent back to catch up");
  expect(summarizeOutput({ answer: "MIT", answeredBy: "cli", answeredAt: "" })).toBe("Answered: MIT");
});

test("long text is cut, and unknown output has no summary", () => {
  expect(summarizeOutput({ status: "done", summary: "x".repeat(300) })!.length).toBeLessThanOrEqual(160);
  expect(summarizeOutput({ something: 1 })).toBeUndefined();
  expect(summarizeOutput(null)).toBeUndefined();
});

test("a planner that asks is summarized by its question", () => {
  expect(summarizeOutput({ status: "needs_input", plan: "", steps: [], ownedPaths: [], question: { text: "SQLite or JSON?" } })).toBe("Asked: SQLite or JSON?");
});

test("a question with a summary is summarized by it", () => {
  const question = { text: "The store has two options. SQLite keeps history, JSON is simpler to read. Which one?", summary: "SQLite or JSON for the store?" };
  expect(summarizeOutput({ status: "needs_input", plan: "", steps: [], ownedPaths: [], question })).toBe("Asked: SQLite or JSON for the store?");
  expect(summarizeOutput({ status: "needs_input", summary: "", question })).toBe("Asked: SQLite or JSON for the store?");
});
