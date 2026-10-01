import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { DiffFile, DiffLine } from "@handoff/core";
import { CodeReview } from "./code-review";

const actions = vi.hoisted(() => ({ answerReviewAction: vi.fn(), markViewedAction: vi.fn() }));
vi.mock("@/app/inbox/actions", () => actions);
beforeEach(() => {
  actions.answerReviewAction.mockReset().mockResolvedValue({ ok: true });
  actions.markViewedAction.mockReset().mockResolvedValue({ ok: true });
  window.localStorage.clear();
});

/** src/a.ts: twenty lines where line 10 was replaced. */
function modified(): DiffFile {
  const lines: DiffLine[] = [];
  for (let i = 1; i <= 20; i++) {
    if (i === 10) lines.push({ kind: "del", oldLine: 10, text: "old 10" }, { kind: "add", newLine: 10, text: "new 10" });
    else
      lines.push({
        kind: "context",
        oldLine: i,
        newLine: i,
        text: `line ${i}`,
      });
  }
  return {
    path: "src/a.ts",
    status: "modified",
    additions: 1,
    deletions: 1,
    whole: true,
    blob: "b1",
    hunks: [{ oldStart: 1, newStart: 1, lines }],
  };
}

const files: DiffFile[] = [
  modified(),
  {
    path: "src/b.ts",
    blob: "b2",
    status: "added",
    additions: 2,
    deletions: 0,
    whole: true,
    hunks: [
      {
        oldStart: 0,
        newStart: 1,
        lines: [
          { kind: "add", newLine: 1, text: "export const b = 1;" },
          { kind: "add", newLine: 2, text: "export const c = 2;" },
        ],
      },
    ],
  },
  {
    path: "pnpm-lock.yaml",
    status: "modified",
    additions: 500,
    deletions: 20,
    collapsed: "generated",
    hunks: [],
  },
];

const props = {
  questionId: "q1",
  runId: "r1",
  from: "coder-1",
  markdown: "Added the scaffold.",
  files,
  views: [],
  earlier: [],
};
const fileA = () => screen.getByRole("region", { name: "src/a.ts" });

test("every file has a header with its counts, a new file says so, and a generated file says why its lines are hidden", () => {
  render(<CodeReview {...props} />);
  expect(screen.getByText("Added the scaffold.")).toBeInTheDocument();
  expect(within(fileA()).getByText("−1")).toBeInTheDocument();
  expect(within(fileA()).getByText("+1")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "src/b.ts" })).getByText("new file")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "pnpm-lock.yaml" })).getByText(/generated file/i)).toBeInTheDocument();
});

test("the toolbar counts the comments drafted so far", () => {
  render(<CodeReview {...props} />);
  expect(screen.queryByText(/drafted/)).not.toBeInTheDocument();
  fireEvent.click(within(fileA()).getByRole("button", { name: "Select line 9" }));
  fireEvent.change(within(fileA()).getByLabelText("Comment on src/a.ts line 9"), { target: { value: "One." } });
  fireEvent.click(within(fileA()).getByRole("button", { name: "Add comment" }));
  expect(screen.getByText("1 comment drafted")).toBeInTheDocument();
});

test("unchanged lines fold around the change, expand in place, and the whole file shows them all", () => {
  render(<CodeReview {...props} />);
  expect(within(fileA()).queryByText("line 1")).not.toBeInTheDocument();
  fireEvent.click(within(fileA()).getByRole("button", { name: "Show 6 unmodified lines" }));
  expect(within(fileA()).getByText("line 1")).toBeInTheDocument();
  expect(within(fileA()).queryByText("line 20")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Whole file" }));
  expect(within(fileA()).getByText("line 20")).toBeInTheDocument();
});

test("a range of lines is selected with click and shift-click, commented on, and sent back with changes", async () => {
  render(<CodeReview {...props} />);
  fireEvent.click(within(fileA()).getByRole("button", { name: "Select line 9" }));
  fireEvent.click(within(fileA()).getByRole("button", { name: "Select line 11" }), { shiftKey: true });
  fireEvent.change(within(fileA()).getByLabelText("Comment on src/a.ts lines 9–11"), { target: { value: "Explain this." } });
  fireEvent.click(within(fileA()).getByRole("button", { name: "Add comment" }));
  expect(within(fileA()).getByText("Explain this.")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Submit review" }));
  fireEvent.change(screen.getByLabelText("Overall comment"), {
    target: { value: "Close." },
  });
  fireEvent.click(screen.getByRole("radio", { name: /Request changes/ }));
  fireEvent.click(screen.getByRole("button", { name: "Send review" }));
  await waitFor(() =>
    expect(actions.answerReviewAction).toHaveBeenCalledWith({
      questionId: "q1",
      runId: "r1",
      option: "changes",
      note: "Close.",
      comments: [
        {
          path: "src/a.ts",
          side: "new",
          line: 9,
          endLine: 11,
          quote: "line 9\nnew 10\nline 11",
          body: "Explain this.",
        },
      ],
    }),
  );
});

test("approve after fixes needs something to fix, then sends fix", async () => {
  render(<CodeReview {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Submit review" }));
  fireEvent.click(screen.getByRole("radio", { name: /Approve after fixes/ }));
  fireEvent.click(screen.getByRole("button", { name: "Send review" }));
  expect(await screen.findByText(/add a comment/i)).toBeInTheDocument();
  expect(actions.answerReviewAction).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Overall comment"), {
    target: { value: "Rename b to value." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send review" }));
  await waitFor(() =>
    expect(actions.answerReviewAction).toHaveBeenCalledWith(
      expect.objectContaining({
        option: "fix",
        note: "Rename b to value.",
        comments: [],
      }),
    ),
  );
});

test("prev, next and the [ and ] keys move between files, and the file menu names the current one", () => {
  render(<CodeReview {...props} />);
  expect(screen.getByRole("button", { name: "src/a.ts 1 of 3" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next file" }));
  expect(screen.getByRole("button", { name: "src/b.ts 2 of 3" })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "]" });
  expect(screen.getByRole("button", { name: "pnpm-lock.yaml 3 of 3" })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "[" });
  fireEvent.click(screen.getByRole("button", { name: "Previous file" }));
  expect(screen.getByRole("button", { name: "src/a.ts 1 of 3" })).toBeInTheDocument();
});

/** Opens the file menu and returns its text. */
function fileMenuText() {
  fireEvent.keyDown(screen.getByRole("button", { name: /of 3$/ }), { key: "Enter" });
  return screen.getByRole("menu").textContent;
}

test("a file collapses and expands from its header", () => {
  render(<CodeReview {...props} />);
  fireEvent.click(within(fileA()).getByRole("button", { name: "Collapse src/a.ts" }));
  expect(within(fileA()).queryByText("new 10")).not.toBeInTheDocument();
  fireEvent.click(within(fileA()).getByRole("button", { name: "Expand src/a.ts" }));
  expect(within(fileA()).getByText("new 10")).toBeInTheDocument();
});

test("text typed in the comment box stays when the range is extended", () => {
  render(<CodeReview {...props} />);
  fireEvent.click(within(fileA()).getByRole("button", { name: "Select line 9" }));
  fireEvent.change(within(fileA()).getByLabelText("Comment on src/a.ts line 9"), { target: { value: "Half a thought" } });
  fireEvent.click(within(fileA()).getByRole("button", { name: "Select line 11" }), { shiftKey: true });
  expect(within(fileA()).getByLabelText("Comment on src/a.ts lines 9–11")).toHaveValue("Half a thought");
});

test("ticking viewed saves the mark, collapses the file and counts it in the file menu", async () => {
  render(<CodeReview {...props} />);
  const viewed = within(fileA()).getByRole("checkbox", { name: "Viewed" });
  expect(viewed).not.toBeChecked();
  fireEvent.click(viewed);
  expect(actions.markViewedAction).toHaveBeenCalledWith({ runId: "r1", path: "src/a.ts", blobSha: "b1", viewed: true });
  expect(within(fileA()).getByRole("checkbox", { name: "Viewed" })).toBeChecked();
  expect(within(fileA()).queryByText("new 10")).not.toBeInTheDocument();
  expect(fileMenuText()).toContain("1 of 3 viewed");
});

test("files keep their marks from earlier rounds unless they changed or were commented on", () => {
  const views = [
    { path: "src/a.ts", blobSha: "b1", viewedAt: new Date("2026-10-01T09:00:00Z") },
    { path: "src/b.ts", blobSha: "old", viewedAt: new Date("2026-10-01T09:00:00Z") },
    { path: "pnpm-lock.yaml", blobSha: "x", viewedAt: new Date("2026-10-01T09:00:00Z") },
  ];
  render(<CodeReview {...props} files={[...files.slice(0, 2), { ...files[2]!, blob: "x" }]} views={views} />);
  expect(within(fileA()).getByRole("checkbox", { name: "Viewed" })).toBeChecked();
  expect(within(screen.getByRole("region", { name: "src/b.ts" })).getByText("Changed since you viewed it")).toBeInTheDocument();
  expect(fileMenuText()).toContain("2 of 3 viewed");
});

test("last round's comments show next to the code they were about, or as outdated when it is gone", () => {
  const earlier = [
    {
      answer: "Round one.",
      option: "changes",
      answeredAt: new Date("2026-10-01T10:00:00Z"),
      comments: [
        { path: "src/a.ts", line: 11, quote: "line 11", body: "Is this needed?" },
        { path: "src/a.ts", line: 10, quote: "gone 10", body: "This line was wrong." },
      ],
    },
  ];
  render(<CodeReview {...props} views={[{ path: "src/a.ts", blobSha: "b1", viewedAt: new Date("2026-10-01T09:00:00Z") }]} earlier={earlier} />);
  // A file commented on last round is not viewed, even though it did not change.
  expect(within(fileA()).getByText("You commented on it last round")).toBeInTheDocument();
  expect(within(fileA()).getByText("Is this needed?")).toBeInTheDocument();
  expect(within(fileA()).getByText("This line was wrong.").closest("[data-outdated]")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Last round 2" }));
  expect(screen.getByText("Round one.")).toBeInTheDocument();
});

test("draft comments and the overall comment survive leaving the page", () => {
  const { unmount } = render(<CodeReview {...props} />);
  fireEvent.click(within(fileA()).getByRole("button", { name: "Select line 9" }));
  fireEvent.change(within(fileA()).getByLabelText("Comment on src/a.ts line 9"), { target: { value: "Keep me." } });
  fireEvent.click(within(fileA()).getByRole("button", { name: "Add comment" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit review" }));
  fireEvent.change(screen.getByLabelText("Overall comment"), { target: { value: "Half done." } });
  unmount();
  render(<CodeReview {...props} />);
  expect(within(fileA()).getByText("Keep me.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Submit review" }));
  expect(screen.getByLabelText("Overall comment")).toHaveValue("Half done.");
});

test("split view puts the old lines on the left and the new lines on the right", () => {
  render(<CodeReview {...props} />);
  fireEvent.click(screen.getByRole("radio", { name: "Split" }));
  const row = within(fileA()).getByText("old 10").closest("tr")!;
  expect(within(row).getByText("new 10")).toBeInTheDocument();
  expect(within(row).getByRole("button", { name: "Select old line 10" })).toBeInTheDocument();
  expect(within(row).getByRole("button", { name: "Select line 10" })).toBeInTheDocument();
});

test("the code reviewer's findings sit on their lines, and the summary lists each one with where it is", () => {
  const findings = {
    verdict: "approve" as const,
    by: "code_review-1",
    comments: [
      { path: "src/a.ts", line: 10, body: "Suggestion: name the constant." },
      { path: "src/b.ts", line: 2, body: "Suggestion: export one thing." },
      { path: "docs/notes.md", line: 3, body: "Suggestion: link the ADR." },
    ],
  };
  render(<CodeReview {...props} markdown={"Verdict: approve\n\n- a wall of text"} findings={findings} from="coder-1" />);
  const summary = screen.getByRole("region", { name: "Code review findings" });
  expect(within(summary).getByRole("heading", { name: "Code review found 3 things" })).toBeInTheDocument();
  expect(summary).toHaveTextContent("code_review-1 · approved · 2 in the diff");
  // A finding on a file in the diff links to it; one on a file outside the diff is only a location.
  expect(within(summary).getByRole("button", { name: "src/a.ts:10" })).toBeInTheDocument();
  expect(within(summary).queryByRole("button", { name: "docs/notes.md:3" })).not.toBeInTheDocument();
  expect(summary).toHaveTextContent("docs/notes.md:3");
  expect(summary).toHaveTextContent("Suggestion: link the ADR.");
  expect(screen.queryByText("a wall of text")).not.toBeInTheDocument();
  const a = screen.getByRole("region", { name: "src/a.ts" });
  expect(within(a).getByText("Suggestion: name the constant.")).toBeInTheDocument();
  expect(within(a).getByText("1 finding")).toBeInTheDocument();
});

test("a code review without findings says the reviewer found nothing", () => {
  render(<CodeReview {...props} findings={{ verdict: "approve", by: "code_review-1", comments: [] }} />);
  expect(screen.getByRole("heading", { name: "Code review found nothing" })).toBeInTheDocument();
});
