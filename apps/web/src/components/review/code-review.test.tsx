import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { DiffFile, DiffLine } from "@handoff/core";
import { CodeReview } from "./code-review";

const actions = vi.hoisted(() => ({ answerReviewAction: vi.fn() }));
vi.mock("@/app/inbox/actions", () => actions);
beforeEach(() => actions.answerReviewAction.mockReset().mockResolvedValue({ ok: true }));

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
};
const fileA = () => screen.getByRole("region", { name: "src/a.ts" });

test("every file has a header with its counts, and a generated file says why its lines are hidden", () => {
  render(<CodeReview {...props} />);
  expect(screen.getByText("Added the scaffold.")).toBeInTheDocument();
  expect(within(fileA()).getByText("−1")).toBeInTheDocument();
  expect(within(fileA()).getByText("+1")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "pnpm-lock.yaml" })).getByText(/generated file/i)).toBeInTheDocument();
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

test("prev, next and the [ and ] keys move between files", () => {
  render(<CodeReview {...props} />);
  expect(screen.getByRole("button", { name: /File 1 of 3/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next file" }));
  expect(screen.getByRole("button", { name: /File 2 of 3/ })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "]" });
  expect(screen.getByRole("button", { name: /File 3 of 3/ })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "[" });
  fireEvent.click(screen.getByRole("button", { name: "Previous file" }));
  expect(screen.getByRole("button", { name: /File 1 of 3/ })).toBeInTheDocument();
});

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
