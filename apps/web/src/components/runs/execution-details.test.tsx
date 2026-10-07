import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { ExecutionDetails, type ExecutionDetail } from "./execution-details";

const base: ExecutionDetail = {
  id: "e1",
  nodeKey: "node",
  nodeType: "planner",
  attempt: 1,
  status: "passed",
  output: null,
  checks: null,
  error: null,
  trigger: { kind: "start" },
  costUsd: null,
  startedAt: "2026-09-30T06:52:46.000Z",
  finishedAt: "2026-09-30T06:53:01.000Z",
  repairNote: null,
};

test("a Planner shows its plan, steps and owned paths", () => {
  render(<ExecutionDetails detail={{ ...base, output: { plan: "Add a module.", steps: ["Write the test", "Write slugify"], ownedPaths: ["src/**"] } }} />);
  expect(screen.getByText("Add a module.")).toBeInTheDocument();
  expect(screen.getByText("Write slugify")).toBeInTheDocument();
  expect(screen.getByText("src/**")).toBeInTheDocument();
});

test("a Planner shows the acceptance criteria it wrote", () => {
  render(<ExecutionDetails detail={{ ...base, output: { plan: "Add a board.", steps: [], ownedPaths: [], acceptance: ["A user can create a new task"] } }} />);
  expect(screen.getByRole("heading", { name: "Acceptance criteria" })).toBeInTheDocument();
  expect(screen.getByText("A user can create a new task")).toBeInTheDocument();
});

test("a Demo shows its screenshots with their captions and whether each criterion works", () => {
  render(
    <ExecutionDetails
      detail={{
        ...base,
        nodeType: "demo",
        output: {
          summary: "Created a task.",
          shots: [
            { file: "page-1.png", caption: "The new task in the list", criterion: "A user can create a new task", works: true, artifactId: "a1" },
            { file: "page-2.png", caption: "Empty after reload", criterion: "Tasks persist", works: false, artifactId: "a2" },
          ],
        },
      }}
    />,
  );
  const [first, second] = screen.getAllByRole("figure");
  expect(within(first!).getByRole("img", { name: "The new task in the list" })).toHaveAttribute("src", "/api/screenshots/a1");
  expect(within(first!).getByText("Works")).toBeInTheDocument();
  expect(within(second!).getByText("Does not work")).toBeInTheDocument();
  expect(within(second!).getByText("Tasks persist")).toBeInTheDocument();
});

test("a Planner that asks shows its question instead of a plan", () => {
  render(<ExecutionDetails detail={{ ...base, nodeType: "planner", output: { status: "needs_input", plan: "", steps: [], ownedPaths: [], question: { text: "SQLite or JSON?" } } }} />);
  expect(screen.getByText("SQLite or JSON?")).toBeInTheDocument();
  expect(screen.queryByText("Plan")).not.toBeInTheDocument();
});

test("a Coder shows its summary, changed files and commit", () => {
  render(
    <ExecutionDetails
      detail={{ ...base, nodeType: "coder", output: { status: "done", summary: "Added slugify.", filesChanged: ["src/slugify.js"], commitSha: "6aca884d0a3397e9" } }}
    />,
  );
  expect(screen.getByText("Added slugify.")).toBeInTheDocument();
  expect(screen.getByText("src/slugify.js")).toBeInTheDocument();
  expect(screen.getByText("6aca884")).toBeInTheDocument();
});

test("a Coder shows the files it changed outside the plan, with the reason", () => {
  render(
    <ExecutionDetails
      detail={{ ...base, nodeType: "coder", output: { status: "done", summary: "Done.", extraPaths: [{ path: "pnpm-workspace.yaml", reason: "pnpm 12 reads build approvals only here" }] } }}
    />,
  );
  expect(screen.getByText("Files outside the plan")).toBeInTheDocument();
  expect(screen.getByText("pnpm-workspace.yaml")).toBeInTheDocument();
  expect(screen.getByText("pnpm 12 reads build approvals only here")).toBeInTheDocument();
});

test("a Coder that needs input shows its question", () => {
  render(<ExecutionDetails detail={{ ...base, nodeType: "coder", output: { status: "needs_input", summary: "", question: { text: "Which license?" } } }} />);
  expect(screen.getByText("Which license?")).toBeInTheDocument();
});

test("a Tester shows the command, exit code and output tail", () => {
  render(<ExecutionDetails detail={{ ...base, nodeType: "tester", output: { passed: false, command: "npm test", exitCode: 1, tail: "not ok 1 - slugify" } }} />);
  expect(screen.getByText("npm test")).toBeInTheDocument();
  expect(screen.getByText(/exit 1/)).toBeInTheDocument();
  expect(screen.getByText("not ok 1 - slugify")).toBeInTheDocument();
});

test("a Tester that passed only on its retry shows the note about the first run", () => {
  const note = "The first run failed (exited 1) and a retry passed, so a test may be flaky. The first run's output:\nFAIL flaky.test.ts";
  render(<ExecutionDetails detail={{ ...base, nodeType: "tester", output: { passed: true, command: "npm test", exitCode: 0, tail: "1 passed", note } }} />);
  expect(screen.getByText(/a retry passed, so a test may be flaky/)).toBeInTheDocument();
});

test("a Reviewer shows its verdict and each comment with its location", () => {
  render(
    <ExecutionDetails
      detail={{ ...base, nodeType: "reviewer", output: { verdict: "request_changes", comments: [{ path: "src/slugify.js", line: 4, body: "Name the regex." }] } }}
    />,
  );
  expect(screen.getByText("Changes requested")).toBeInTheDocument();
  expect(screen.getByText("src/slugify.js:4")).toBeInTheDocument();
  expect(screen.getByText("Name the regex.")).toBeInTheDocument();
});

test("a PR node links the pull request and shows CI and review feedback", () => {
  render(
    <ExecutionDetails
      detail={{
        ...base,
        nodeType: "pr",
        output: {
          prNumber: 7,
          prUrl: "https://github.com/o/r/pull/7",
          headSha: "abc",
          feedback: {
            ci: { status: "failure", failedJobs: [{ name: "check", jobId: 1, url: "https://github.com/o/r/actions/runs/1/job/1", logExcerpt: "npm ERR! test failed" }] },
            review: { decision: "changes_requested", comments: [{ author: "octocat", path: "README.md", line: 2, body: "Typo.", url: "u", resolved: false }], unresolvedThreads: 1 },
            updatedAt: "2026-09-30T06:53:51.033Z",
          },
        },
      }}
    />,
  );
  expect(screen.getByRole("link", { name: /#7/ })).toHaveAttribute("href", "https://github.com/o/r/pull/7");
  expect(screen.getByText("CI failing")).toBeInTheDocument();
  expect(screen.getByText("npm ERR! test failed")).toBeInTheDocument();
  expect(screen.getByText("Typo.")).toBeInTheDocument();
  expect(screen.getByText(/octocat/)).toBeInTheDocument();
});

test("a PR node that sent review items back shows GitHub's decision and how many comments the coder answers", () => {
  // As on northMES/northmes#285: CodeRabbit approved, and one pre-merge check went to the coder.
  const pr = (review: Record<string, unknown>) => ({
    ...base,
    nodeType: "pr",
    output: {
      prNumber: 285,
      prUrl: "https://github.com/o/r/pull/285",
      headSha: "abc",
      feedback: {
        ci: { status: "success", failedJobs: [] },
        review: {
          decision: "changes_requested",
          comments: [{ author: "coderabbitai", body: "Linked Issues check (warning): no e2e leg.", url: "u", resolved: false, item: "R1", kind: "pre_merge_check" }],
          unresolvedThreads: 0,
          ...review,
        },
        updatedAt: "2026-10-07T19:25:51Z",
      },
    },
  });
  const { unmount } = render(<ExecutionDetails detail={pr({ githubDecision: "approved" })} />);
  expect(screen.getByText("review: approved")).toBeInTheDocument();
  expect(screen.getByText("1 review comment to answer")).toBeInTheDocument();
  expect(screen.queryByText(/changes requested/)).not.toBeInTheDocument();
  unmount();

  // An output from before GitHub's decision was recorded shows the decision it has.
  render(<ExecutionDetails detail={pr({})} />);
  expect(screen.getByText("review: changes requested")).toBeInTheDocument();
  expect(screen.queryByText(/to answer/)).not.toBeInTheDocument();
});

test("a PR node that found a conflict with main lists the conflicting files", () => {
  render(<ExecutionDetails detail={{ ...base, nodeType: "pr", output: { sync: "conflict", conflict: { base: "main", baseSha: "abc1234def", files: ["package.json", "README.md"] } } }} />);
  expect(screen.getByText("Conflicts with main")).toBeInTheDocument();
  expect(screen.getByText("package.json")).toBeInTheDocument();
  expect(screen.getByText("README.md")).toBeInTheDocument();
});

test("a merge sent back to catch up with main says so", () => {
  render(<ExecutionDetails detail={{ ...base, nodeType: "merge", output: { merged: false, needsUpdate: true } }} />);
  expect(screen.getByText(/GitHub refused the merge because the branch conflicts with main/)).toBeInTheDocument();
});

test("a failed execution shows its error and the failed checks with their logs", () => {
  render(
    <ExecutionDetails
      detail={{
        ...base,
        nodeType: "coder",
        status: "failed",
        error: { code: "checks_failed", message: "tests_green failed" },
        checks: [
          { kind: "diff_within_paths", passed: true, detail: "2 files", durationMs: 3 },
          { kind: "tests_green", passed: false, detail: "exit 1", durationMs: 900, logTail: "AssertionError: expected 'a-b'" },
        ],
      }}
    />,
  );
  expect(screen.getByText("tests_green failed")).toBeInTheDocument();
  expect(screen.getByText("AssertionError: expected 'a-b'")).toBeInTheDocument();
  expect(screen.getByText("diff_within_paths")).toBeInTheDocument();
});

test("an execution a repair started says so; its status, time and cost sit in the drawer's header instead", () => {
  render(<ExecutionDetails detail={{ ...base, trigger: { kind: "repair" }, costUsd: "0.12" }} />);
  expect(screen.getByText("Started by a repair")).toBeInTheDocument();
  expect(screen.queryByText("$0.12")).not.toBeInTheDocument();
});

test("output of an unknown shape is shown as JSON", () => {
  render(<ExecutionDetails detail={{ ...base, nodeType: "function", output: { answer: 42 } }} />);
  expect(screen.getByText(/"answer": 42/)).toBeInTheDocument();
});
