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

test("a Coder that answered review comments says how many and its verdicts, and an answer-only round says it made no commit", () => {
  const answer = (id: string, verdict: string) => ({ id, verdict, evidence: "Checked." });
  const answers = [answer("R1", "fixed"), answer("R2", "fixed"), answer("R3", "declined"), answer("R4", "unclear"), answer("R5", "duplicate")];
  expect(summarizeOutput({ status: "done", summary: "Fixed two of the comments.", answers })).toBe("Answered 5 review comments: 2 fixed, 1 declined, 1 unclear, 1 duplicate");
  expect(summarizeOutput({ status: "done", summary: "Nothing to change.", answers: [answer("R1", "declined"), answer("R2", "declined")], answerOnly: true })).toBe(
    "Answered 2 review comments, no commit",
  );
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

test("a pull request sent back for review comments says GitHub's decision and how many comments there are", () => {
  const pr = (review: Record<string, unknown>, comments: Record<string, unknown>[]) => ({
    prNumber: 285,
    prUrl: "u",
    headSha: "abc",
    feedback: { ci: { status: "success", failedJobs: [] }, review: { comments, unresolvedThreads: 0, ...review }, updatedAt: "" },
  });
  const item = (handle: string) => ({ author: "coderabbitai", body: "b", url: "", resolved: false, item: handle, kind: "pre_merge_check" });
  const finding = { author: "coderabbitai", body: "b", url: "", resolved: false };

  // As on northMES/northmes#285: CodeRabbit approved, and one pre-merge check went to the coder to answer.
  expect(summarizeOutput(pr({ decision: "changes_requested", githubDecision: "approved" }, [item("R1")]))).toBe("PR #285, CI passing, approved, 1 review comment to answer");
  expect(summarizeOutput(pr({ decision: "changes_requested", githubDecision: "none" }, [item("R1"), item("R2")]))).toBe("PR #285, CI passing, 2 review comments to answer");
  expect(summarizeOutput(pr({ decision: "changes_requested", githubDecision: "changes_requested" }, [item("R1")]))).toBe(
    "PR #285, CI passing, changes requested, 1 review comment to answer",
  );
  // Without review items, the findings go to the coder to address.
  expect(summarizeOutput(pr({ decision: "changes_requested", githubDecision: "commented" }, [finding]))).toBe("PR #285, CI passing, commented, 1 review comment to address");
  // A person's or a bot's own request for changes, with nothing handoff sent back.
  expect(summarizeOutput(pr({ decision: "changes_requested" }, [finding]))).toBe("PR #285, CI passing, changes requested");
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
