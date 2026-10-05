import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { ReviewItemsQuestionCard } from "./review-items-question";

const actions = vi.hoisted(() => ({ answerReviewItemsAction: vi.fn() }));
vi.mock("@/app/inbox/actions", () => actions);
beforeEach(() => actions.answerReviewItemsAction.mockReset().mockResolvedValue({ ok: true }));

const R2 = {
  id: "R2",
  kind: "thread",
  reviewer: "coderabbitai",
  path: "packages/engine/src/tools/shaping.ts",
  line: 88,
  url: "https://github.com/octo/sample/pull/88#discussion_r2",
  why: "disputed",
  reason: "the reviewer answered back, and the coder declined the comment again",
  comment: "Two create_story calls for the same epic can get the same position.",
  conversation: [
    { author: "handoff", body: "Not changed: the comment does not hold.\n\nBoth statements run in one transaction that locks the epic row." },
    { author: "coderabbitai", body: "The lock covers the epic row, but create_story without epicId skips that branch." },
  ],
  verdict: "declined",
  evidence: "A story without an epic has no position, and that branch returns before nextPosition.",
  replyUrl: "https://github.com/octo/sample/pull/88#discussion_r20",
};
const R10 = {
  ...R2,
  id: "R10",
  path: "packages/core/src/catalog.ts",
  line: 61,
  url: "https://github.com/octo/sample/pull/88#discussion_r10",
  reason: "the reviewer answered back, and the coder's answer is still unclear",
  comment: "The size of create_task accepts any string.",
  conversation: [
    { author: "handoff", body: "Unclear: which should size take?" },
    { author: "coderabbitai", body: "Pick the one the scheduler reads." },
  ],
  verdict: "unclear",
  evidence: "The scheduler reads hours from estimate, not from size.",
};
const R6 = {
  id: "R6",
  kind: "review_body",
  reviewer: "coderabbitai",
  url: "https://github.com/octo/sample/pull/88#pullrequestreview-6",
  why: "no_review",
  reason: "no review from coderabbitai within 30 minutes of the answer",
  comment: "The page tool list still describes two shaping tools.",
  conversation: [],
  verdict: "fixed",
  evidence: "The description names all three tools.",
  commit: "9d03f5b1",
  replyUrl: "https://github.com/octo/sample/pull/88#issuecomment-6",
};

const question = (items: unknown[]) => ({
  id: "q1",
  runId: "r1",
  projectId: "p1",
  task: "#55 Shaping tools in the catalog",
  projectName: "handoff",
  nodeKey: "pr",
  reason: "review_items",
  question: "Decide on review comments R2 and R10 on PR #88: resolve, send back or leave.",
  options: ["resolve", "send_back", "leave"],
  context: { reason: "review_items", summary: "2 review comments on PR #88 need your decision", pr: { number: 88, url: "https://github.com/octo/sample/pull/88" }, items },
});

const block = (id: string) => within(screen.getByRole("region", { name: id }));

test("each item shows the reviewer's comments and the coder's answer, and Submit sends one choice per item", async () => {
  render(<ReviewItemsQuestionCard item={question([R2, R10])} compact />);
  expect(screen.getByText("Review comments to decide")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "CodeRabbit and the coder disagree on 2 review comments" })).toBeInTheDocument();

  const r2 = block("R2");
  expect(r2.getByText("declined twice")).toBeInTheDocument();
  expect(r2.getByRole("link", { name: "packages/engine/src/tools/shaping.ts:88" })).toHaveAttribute("href", R2.url);
  expect(r2.getByText(R2.comment)).toBeInTheDocument();
  expect(r2.getByText(/Both statements run in one transaction/)).toBeInTheDocument();
  expect(r2.getByText(/create_story without epicId skips that branch/)).toBeInTheDocument();
  // The coder's second answer, which handoff did not post.
  expect(r2.getByText(R2.evidence)).toBeInTheDocument();
  expect(r2.getByText("not posted")).toBeInTheDocument();
  expect(block("R10").getByText("unclear twice")).toBeInTheDocument();

  fireEvent.click(r2.getByRole("radio", { name: "Resolve" }));
  fireEvent.change(r2.getByLabelText("Note in the thread (optional)"), { target: { value: "The backlog branch returns first, and the test covers it." } });
  const r10 = block("R10");
  fireEvent.click(r10.getByRole("radio", { name: "Send back" }));
  fireEvent.change(r10.getByLabelText("Note for the coder (optional)"), { target: { value: "Keep XS to XL and type size as a union of those five." } });
  expect(screen.getByText("2 of 2 chosen")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));

  await waitFor(() => expect(actions.answerReviewItemsAction).toHaveBeenCalled());
  expect(actions.answerReviewItemsAction.mock.calls[0]![0]).toEqual({
    questionId: "q1",
    runId: "r1",
    items: [
      { id: "R2", choice: "resolve", note: "The backlog branch returns first, and the test covers it." },
      { id: "R10", choice: "send_back", note: "Keep XS to XL and type size as a union of those five." },
    ],
  });
});

test("Submit names the items without a choice and sends nothing", () => {
  render(<ReviewItemsQuestionCard item={question([R2, R10])} compact />);
  fireEvent.click(block("R2").getByRole("radio", { name: "Leave" }));
  expect(block("R2").queryByLabelText(/Note/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  expect(screen.getByText("Pick a choice for R10.")).toBeInTheDocument();
  expect(actions.answerReviewItemsAction).not.toHaveBeenCalled();
});

test("Resolve all picks Resolve for every item, and an item without a thread reads Mark done and posts nothing", async () => {
  render(<ReviewItemsQuestionCard item={question([R2, R6])} />);
  expect(screen.getByRole("link", { name: "#55 Shaping tools in the catalog" })).toHaveAttribute("href", "/projects/p1/runs/r1");
  const r6 = block("R6");
  expect(r6.getByText("no review in time")).toBeInTheDocument();
  expect(r6.getByRole("link", { name: "9d03f5b" })).toBeInTheDocument();
  expect(r6.queryByRole("radio", { name: "Resolve" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Resolve all" }));
  expect(block("R2").getByRole("radio", { name: "Resolve" })).toHaveAttribute("aria-checked", "true");
  expect(r6.getByRole("radio", { name: "Mark done" })).toHaveAttribute("aria-checked", "true");
  expect(r6.getByText("handoff marks it done. Nothing is posted; this comment has no thread.")).toBeInTheDocument();
  expect(r6.queryByLabelText(/Note/)).not.toBeInTheDocument();
  expect(actions.answerReviewItemsAction).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(actions.answerReviewItemsAction).toHaveBeenCalled());
  expect(actions.answerReviewItemsAction.mock.calls[0]![0].items).toEqual([
    { id: "R2", choice: "resolve" },
    { id: "R6", choice: "resolve" },
  ]);
});
