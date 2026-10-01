import { render, screen } from "@testing-library/react";
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
