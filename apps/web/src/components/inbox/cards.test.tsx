import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { ProjectCards } from "./card-place";
import { FailedRunCard, PullRequestCard, QuestionCard, StuckRunCard } from "./cards";

const actions = vi.hoisted(() => ({
  answerAction: vi.fn(),
  repairAction: vi.fn(),
  cancelAction: vi.fn(),
  resolveLoopAction: vi.fn(),
  answerReviewItemsAction: vi.fn(),
}));
vi.mock("@/app/inbox/actions", () => actions);
vi.mock("@/app/projects/actions", () => ({ requestMergeAction: vi.fn() }));
beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset().mockResolvedValue({ ok: true });
});

const run = { runId: "r1", projectId: "p1", task: "#7 Todo CRUD", projectName: "todooverkill" };

test("a sentence-long option wraps inside the card", () => {
  const option = "Keep the chip border visible on hover with a separator: while the card is hovered, give the chip a bg-background fill.";
  render(<QuestionCard item={{ ...run, id: "q1", question: "How should I handle the hover state?", options: [option], nodeKey: "human_gate-2", reason: "needs_input" }} />);
  const button = screen.getByRole("button", { name: option });
  expect(button).toHaveClass("whitespace-normal", "h-auto", "max-w-full", "shrink");
  expect(button).not.toHaveClass("whitespace-nowrap", "h-8", "shrink-0");
});

test("a question names its project, run and node, and an option answers it", async () => {
  render(<QuestionCard item={{ ...run, id: "q1", question: "Roll back on any error?", options: ["any error", "only 4xx"], nodeKey: "coder", reason: "needs_input" }} />);
  expect(screen.getByRole("link", { name: "todooverkill" })).toHaveAttribute("href", "/projects/p1");
  expect(screen.getByRole("link", { name: "#7 Todo CRUD" })).toHaveAttribute("href", "/projects/p1/runs/r1");
  expect(screen.getByText("coder")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Roll back on any error?" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "any error" }));
  await waitFor(() => expect(actions.answerAction).toHaveBeenCalled());
  const form = actions.answerAction.mock.calls[0]![1] as FormData;
  expect([form.get("questionId"), form.get("option")]).toEqual(["q1", "any error"]);
});

test("on a project's page a question names its run but not the project", () => {
  render(
    <ProjectCards>
      <QuestionCard item={{ ...run, id: "q1", question: "Roll back on any error?", options: ["any error"], nodeKey: "coder", reason: "needs_input" }} />
    </ProjectCards>,
  );
  expect(screen.queryByRole("link", { name: "todooverkill" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "#7 Todo CRUD" })).toHaveAttribute("href", "/projects/p1/runs/r1");
  expect(screen.getByRole("button", { name: "any error" })).toBeInTheDocument();
});

test("on the run page a question leaves out the project and run it is already on", () => {
  render(<QuestionCard compact item={{ ...run, id: "q1", question: "Which license?", options: [], nodeKey: "gate", reason: "needs_input" }} />);
  expect(screen.queryByRole("link", { name: "todooverkill" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send answer" })).toBeInTheDocument();
});

test("a review opens on its review page, with the run beside it", () => {
  render(<QuestionCard item={{ ...run, id: "q2", question: "Approve the plan", options: ["approve", "changes"], nodeKey: "gate", reason: "approval", context: { review: { from: "planner", kind: "plan" } } }} />);
  expect(screen.getByRole("link", { name: "Open the review" })).toHaveAttribute("href", "/projects/p1/runs/r1/review/q2");
  expect(screen.getByRole("link", { name: "Open the run" })).toHaveAttribute("href", "/projects/p1/runs/r1");
  expect(screen.queryByRole("button", { name: "approve" })).not.toBeInTheDocument();
});

test("a Try it question opens its own page, where the app and the criteria are", () => {
  render(<QuestionCard item={{ ...run, id: "q3", question: "Try the app and check each acceptance criterion.", options: ["approve", "changes"], nodeKey: "try", reason: "try", context: { reason: "try" } }} />);
  expect(screen.getByText("Try the app")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open Try it" })).toHaveAttribute("href", "/projects/p1/runs/r1/try/q3");
  expect(screen.queryByRole("button", { name: "approve" })).not.toBeInTheDocument();
});

test("a question about review comments has its own card, which sends a choice per comment", async () => {
  const context = { reason: "review_items", items: [{ id: "R1", kind: "thread", reviewer: "coderabbitai", why: "disputed", comment: "Handle the empty list.", conversation: [], verdict: "declined", evidence: "It is handled." }] };
  render(<QuestionCard item={{ ...run, id: "q5", question: "Decide on review comment R1 on PR #9: resolve, send back or leave.", options: ["resolve", "send_back", "leave"], nodeKey: "pr", reason: "review_items", context }} />);
  expect(screen.getByText("Review comments to decide")).toBeInTheDocument();
  expect(screen.getByText("Handle the empty list.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Leave" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(actions.answerReviewItemsAction).toHaveBeenCalled());
  expect(actions.answerReviewItemsAction.mock.calls[0]![0]).toEqual({ questionId: "q5", runId: "r1", items: [{ id: "R1", choice: "leave" }] });
});

test("a question about files outside the plan offers to allow them, send the work back or fail the step", () => {
  const context = { reason: "paths", from: "coder", files: ["notes.txt"] };
  render(<QuestionCard item={{ ...run, id: "q4", question: "coder changed files outside the plan: `notes.txt`", options: ["allow", "send_back", "fail"], nodeKey: "coder", reason: "paths", context }} />);
  expect(screen.getByText("notes.txt")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Allow for this run" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "send_back" })).not.toBeInTheDocument();
});

test("a failed run shows the error's first line as its title and the rest as output, and repairs with a note", async () => {
  render(
    <FailedRunCard
      item={{ ...run, executionId: "x1", nodeKey: "tester", attempt: 1, error: { code: "TESTS_FAILED", message: "2 of 41 tests failed\n× limit.test.ts > drops the 101st request" } }}
    />,
  );
  expect(screen.getByText("failed at tester")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "TESTS_FAILED: 2 of 41 tests failed" })).toBeInTheDocument();
  expect(screen.getByText("× limit.test.ts > drops the 101st request")).toBeInTheDocument();
  expect(screen.getByText(/Repair re-runs tester as attempt 2/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Note for the retry"), { target: { value: "Use a sliding window" } });
  fireEvent.click(screen.getByRole("button", { name: "Repair tester" }));
  await waitFor(() => expect(actions.repairAction).toHaveBeenCalled());
  const form = actions.repairAction.mock.calls[0]![1] as FormData;
  expect([form.get("executionId"), form.get("note")]).toEqual(["x1", "Use a sliding window"]);
  expect(screen.getByRole("button", { name: "Cancel run" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open the run" })).toHaveAttribute("href", "/projects/p1/runs/r1");
});

test("a failed step shows why it failed, and its repair can allow files outside the plan", async () => {
  const error = { code: "paths_outside_plan", message: "files outside the plan: notes.txt", detail: { files: ["notes.txt"] } };
  render(<FailedRunCard compact item={{ ...run, executionId: "x2", nodeKey: "coder", attempt: 1, error }} />);
  expect(screen.getByText("notes.txt")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Files to allow outside the plan"), { target: { value: "notes.txt" } });
  fireEvent.click(screen.getByRole("button", { name: "Repair coder" }));
  await waitFor(() => expect(actions.repairAction).toHaveBeenCalled());
  const form = actions.repairAction.mock.calls[0]![1] as FormData;
  expect([form.get("executionId"), form.get("allowPaths")]).toEqual(["x2", "notes.txt"]);
});

test("a failed run on an older graph version can be repaired on the latest one, and the choice is off until ticked", async () => {
  render(<FailedRunCard compact item={{ ...run, executionId: "x3", nodeKey: "coder", attempt: 1, error: null, latestGraphVersion: 3 }} />);
  const latest = screen.getByRole("checkbox", { name: "Use the latest graph version (v3)" });
  expect(latest).not.toBeChecked();
  fireEvent.click(latest);
  fireEvent.click(screen.getByRole("button", { name: "Repair coder" }));
  await waitFor(() => expect(actions.repairAction).toHaveBeenCalled());
  const form = actions.repairAction.mock.calls[0]![1] as FormData;
  expect([form.get("executionId"), form.get("latestGraph")]).toEqual(["x3", "on"]);
});

test("a failed run already on its graph's latest version offers no version choice", () => {
  render(<FailedRunCard compact item={{ ...run, executionId: "x4", nodeKey: "coder", attempt: 1, error: null }} />);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

test("a run stuck on a loop asks for a decision and sends it", async () => {
  render(<StuckRunCard item={{ ...run, nodeKey: "reviewer", loop: "reviewer->coder", attempts: 3, finishedAt: null }} />);
  expect(screen.getByText("ran out of rounds")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "reviewer sent the work back 3 times, as often as reviewer->coder allows." })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Another round" }));
  await waitFor(() => expect(actions.resolveLoopAction).toHaveBeenCalledWith({ runId: "r1", action: "retry" }));
  expect(screen.getByRole("button", { name: "Go on as if approved" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Stop the run" })).toBeInTheDocument();
});

test("a pull request waiting for review links to GitHub and says how CI went", () => {
  render(<PullRequestCard item={{ ...run, executionId: "x2", number: 61, url: "https://github.com/octo/app/pull/61", ci: "success", branch: "handoff/7-todo-crud" }} />);
  expect(screen.getByRole("heading", { name: "#61 #7 Todo CRUD" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Review on GitHub" })).toHaveAttribute("href", "https://github.com/octo/app/pull/61");
  expect(screen.getByText("CI passing")).toBeInTheDocument();
  expect(screen.getByText("handoff/7-todo-crud")).toBeInTheDocument();
});

test("a pull request whose merge waits on unresolved review threads asks the person to resolve them on GitHub", () => {
  render(<PullRequestCard item={{ ...run, executionId: "x3", number: 62, url: "https://github.com/octo/app/pull/62", ci: null, branch: "handoff/8-todo", threads: 2 }} />);
  expect(screen.getByText("2 unresolved review threads")).toBeInTheDocument();
  expect(screen.getByText("The merge goes on once they are resolved.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Resolve on GitHub" })).toHaveAttribute("href", "https://github.com/octo/app/pull/62");
  expect(screen.queryByText("The run goes on once the PR is approved.")).not.toBeInTheDocument();
});

test("a question's answer form is a WebMCP tool the person still submits", () => {
  render(<QuestionCard item={{ ...run, id: "q1", question: "Which license?", options: [], nodeKey: "gate", reason: "needs_input" }} />);
  const form = screen.getByRole("button", { name: "Send answer" }).closest("form")!;
  expect(form).toHaveAttribute("toolname", "answer_question_q1");
  expect(form.getAttribute("tooldescription")).toMatch(/Which license\?/);
  expect(form).not.toHaveAttribute("toolautosubmit");
  expect(screen.getByLabelText("Answer")).toHaveAttribute("toolparamdescription", expect.stringContaining("answer"));
});
