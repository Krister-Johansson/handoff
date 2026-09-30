import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { PlanReview } from "./plan-review";

const actions = vi.hoisted(() => ({ answerReviewAction: vi.fn() }));
vi.mock("@/app/inbox/actions", () => actions);
beforeEach(() => {
  actions.answerReviewAction.mockReset().mockResolvedValue({ ok: true });
  window.localStorage.clear();
});

const props = { questionId: "q1", runId: "r1", from: "planner", markdown: "Store todos in a JSON file and add a CLI.\n\n## Steps\n\n1. Add storage" };

/** Selects `text` inside the rendered plan the way a person would with the mouse. */
function select(text: string) {
  const article = screen.getByRole("article");
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.textContent!.indexOf(text);
    if (at === -1) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + text.length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent(document, new Event("selectionchange"));
    return;
  }
  throw new Error(`${text} is not in the plan`);
}

test("the plan is rendered, and a selected passage can be commented on", () => {
  render(<PlanReview {...props} />);
  expect(screen.getByRole("heading", { name: "Steps" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add comment" })).toBeDisabled();
  select("a JSON file");
  expect(screen.getByText('"a JSON file"')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Use SQLite instead." } });
  fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
  expect(screen.getByRole("list", { name: "Comments" })).toHaveTextContent("a JSON file");
  expect(screen.getByRole("list", { name: "Comments" })).toHaveTextContent("Use SQLite instead.");
});

test("requesting changes sends the note and every comment with its quote", async () => {
  render(<PlanReview {...props} />);
  select("add a CLI");
  fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "A web page, not a CLI." } });
  fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
  fireEvent.change(screen.getByLabelText("Overall comment"), { target: { value: "Close." } });
  fireEvent.click(screen.getByRole("radio", { name: /Request changes/ }));
  fireEvent.click(screen.getByRole("button", { name: "Send review" }));
  await waitFor(() =>
    expect(actions.answerReviewAction).toHaveBeenCalledWith({ questionId: "q1", runId: "r1", option: "changes", note: "Close.", comments: [{ quote: "add a CLI", body: "A web page, not a CLI." }] }),
  );
});

test("a comment can be removed, and approving sends approve", async () => {
  render(<PlanReview {...props} />);
  select("Add storage");
  fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Fine." } });
  fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove comment on Add storage" }));
  expect(screen.queryByRole("list", { name: "Comments" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: /^Approve Let the run/ }));
  fireEvent.click(screen.getByRole("button", { name: "Send review" }));
  await waitFor(() => expect(actions.answerReviewAction).toHaveBeenCalledWith({ questionId: "q1", runId: "r1", option: "approve", note: "", comments: [] }));
});

test("approve after fixes sends the comments back with fix", async () => {
  render(<PlanReview {...props} />);
  select("add a CLI");
  fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "A web page." } });
  fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
  expect(screen.getAllByText(/Send your comments back to planner/)).toHaveLength(2);
  fireEvent.click(screen.getByRole("radio", { name: /Approve after fixes/ }));
  fireEvent.click(screen.getByRole("button", { name: "Send review" }));
  await waitFor(() => expect(actions.answerReviewAction).toHaveBeenCalledWith({ questionId: "q1", runId: "r1", option: "fix", note: "", comments: [{ quote: "add a CLI", body: "A web page." }] }));
});
