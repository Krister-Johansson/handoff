import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { ReviewItemView } from "@/lib/review-items";
import { ReviewItemsCard } from "./review-items-card";

const PR = { number: 88, url: "https://github.com/octo/sample/pull/88" };

function item(id: string, over: Partial<ReviewItemView> = {}): ReviewItemView {
  return {
    id,
    kind: "thread",
    reviewer: "coderabbitai",
    reviewerBot: true,
    path: "packages/core/src/catalog.ts",
    line: 47,
    url: `https://github.com/octo/sample/pull/88#discussion_${id}`,
    outdated: false,
    body: "create_task is registered without an input schema.\nThe approval card shows its input as raw JSON.",
    round: 1,
    verdict: null,
    evidence: null,
    commit: null,
    commitUrl: null,
    duplicateOf: null,
    replyUrl: null,
    repliedAt: null,
    waitUntil: null,
    state: "open",
    stateReason: null,
    resolvedBy: null,
    resolvedAt: null,
    reraisedAs: null,
    ...over,
  };
}

const fixed = item("R1", {
  outdated: true,
  verdict: "fixed",
  evidence: 'Valid. The test "every shaping tool has an input schema" failed and passes now.',
  commit: "4e1a9c2d0b",
  commitUrl: "https://github.com/octo/sample/commit/4e1a9c2d0b",
  replyUrl: "https://github.com/octo/sample/pull/88#discussion_r9",
  repliedAt: "2026-10-05T14:31:00Z",
  waitUntil: "2026-10-05T15:01:00Z",
  state: "awaiting_review",
});
const declined = item("R2", {
  path: "packages/engine/src/tools/shaping.ts",
  line: 88,
  body: "Two create_story calls for the same epic can get the same position.",
  verdict: "declined",
  evidence: "Not changed. Both statements run in one transaction that locks the epic row.",
  replyUrl: "https://github.com/octo/sample/pull/88#discussion_r10",
  state: "disputed",
  stateReason: "the reviewer answered back, and the coder declined the comment again",
});
const resolved = item("R4", { path: "packages/core/src/catalog.ts", line: 3, body: "Unused import of ShapingInput.", verdict: "fixed", evidence: "Removed.", commit: "4e1a9c2", state: "resolved", resolvedBy: "coderabbitai", resolvedAt: "2026-10-05T14:32:00Z" });
const check = item("R9", {
  kind: "pre_merge_check",
  path: null,
  line: null,
  url: PR.url,
  body: 'Title check: "Shaping tools" does not describe the change.',
  verdict: "fixed",
  evidence: 'The PR title is now "Add create_task to the tool catalog".',
  replyUrl: `${PR.url}#issuecomment-5`,
  state: "awaiting_review",
});
const waiting = item("R11", { path: "packages/core/src/catalog.ts", line: 58, body: "Export the shaping tool names as a const.", round: 4 });

const rowOf = (id: string) => screen.getByText(id, { selector: "[data-handle]" }).closest("li")!;

test("each item shows its handle, verdict, evidence, commit and state, and outdated threads are marked", () => {
  render(<ReviewItemsCard runId="run-1" pr={PR} items={[resolved, fixed, declined, check, waiting]} />);

  const r1 = within(rowOf("R1"));
  expect(r1.getByRole("link", { name: "packages/core/src/catalog.ts:47" })).toHaveAttribute("href", fixed.url);
  expect(r1.getByText("outdated")).toBeInTheDocument();
  expect(r1.getByText("Fixed")).toBeInTheDocument();
  expect(r1.getByText(/every shaping tool has an input schema/)).toBeInTheDocument();
  expect(r1.getByRole("link", { name: "4e1a9c2" })).toHaveAttribute("href", "https://github.com/octo/sample/commit/4e1a9c2d0b");
  expect(r1.getByRole("link", { name: "reply" })).toHaveAttribute("href", fixed.replyUrl);
  expect(r1.getByText("waiting for review")).toBeInTheDocument();

  const r2 = within(rowOf("R2"));
  expect(r2.queryByText("outdated")).not.toBeInTheDocument();
  expect(r2.getByText("Declined")).toBeInTheDocument();
  expect(r2.getByText("needs you")).toBeInTheDocument();
  expect(r2.getByText("the reviewer answered back, and the coder declined the comment again")).toBeInTheDocument();

  // A resolved item shrinks to one line: what it was, its verdict, and who resolved it.
  const r4 = within(rowOf("R4"));
  expect(r4.getByText("resolved")).toBeInTheDocument();
  expect(r4.getByText(/by coderabbitai/)).toBeInTheDocument();
  expect(r4.queryByText("Removed.")).not.toBeInTheDocument();

  const r9 = within(rowOf("R9"));
  expect(r9.getByText("pre-merge check")).toBeInTheDocument();
  expect(r9.getByText("waiting for summary")).toBeInTheDocument();
  expect(r9.getByRole("link", { name: "round comment" })).toHaveAttribute("href", check.replyUrl);

  const r11 = within(rowOf("R11"));
  expect(r11.getByText("with the coder")).toBeInTheDocument();
  expect(r11.getByText("No answer yet. The coder has it in round 4.")).toBeInTheDocument();
});

test("items are grouped by where they come from, with the unresolved ones first", () => {
  render(<ReviewItemsCard runId="run-1" pr={PR} items={[resolved, fixed, declined, check, waiting]} />);
  const threads = within(screen.getByRole("region", { name: "Threads" }));
  expect(threads.getAllByText(/^R\d+$/, { selector: "[data-handle]" }).map((h) => h.textContent)).toEqual(["R1", "R2", "R11", "R4"]);
  const summary = within(screen.getByRole("region", { name: "coderabbitai's summary comment" }));
  expect(summary.getAllByText(/^R\d+$/, { selector: "[data-handle]" }).map((h) => h.textContent)).toEqual(["R9"]);
  expect(screen.getByText("Review comments")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "PR #88" })).toHaveAttribute("href", PR.url);
});

test("the card folds to a one-line summary, keeps the fold for the run, and starts folded once every item is resolved", () => {
  const { unmount } = render(<ReviewItemsCard runId="run-1" pr={PR} items={[fixed, resolved]} />);
  expect(screen.getByText("2 comments: 1 waiting for a review, 1 resolved.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Fold review comments" }));
  expect(screen.queryByRole("region", { name: "Threads" })).not.toBeInTheDocument();
  unmount();

  render(<ReviewItemsCard runId="run-1" pr={PR} items={[fixed, resolved]} />);
  expect(screen.queryByRole("region", { name: "Threads" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show review comments" }));
  expect(screen.getByRole("region", { name: "Threads" })).toBeInTheDocument();
  cleanup();
  render(<ReviewItemsCard runId="run-2" pr={PR} items={[resolved]} />);
  expect(screen.getByRole("button", { name: "Show review comments" })).toHaveAttribute("aria-expanded", "false");
});
