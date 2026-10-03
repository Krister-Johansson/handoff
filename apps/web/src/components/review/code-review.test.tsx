import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, type ComponentProps } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import type { DiffFile, DiffLine } from "@handoff/core";
import { AssistantProvider, useAssistant } from "@/components/assistant/assistant-provider";
import type { AssistantPort } from "@/lib/assistant/port";
import { FakeAssistantTransport } from "@/lib/assistant/testing/fake-assistant-transport";
import { CodeReview } from "./code-review";

const actions = vi.hoisted(() => ({ answerReviewAction: vi.fn(), markViewedAction: vi.fn() }));
vi.mock("@/app/inbox/actions", () => actions);
const followUp = vi.hoisted(() => ({ createFollowUpAction: vi.fn() }));
vi.mock("@/app/inbox/follow-up-action", () => followUp);
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/projects/p1/runs/r1/review/q1",
}));
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  followUp.createFollowUpAction.mockReset();
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

const graded = {
  verdict: "request_changes" as const,
  by: "code_review-1",
  comments: [
    { path: "src/a.ts", line: 10, body: "Name the constant.", severity: "should_fix" as const },
    { path: "src/b.ts", line: 2, body: "Crashes on an empty list.", severity: "blocking" as const },
    { path: "docs/notes.md", body: "Link the ADR.", severity: "follow_up" as const },
  ],
};

test("findings are grouped by severity", () => {
  render(<CodeReview {...props} findings={graded} />);
  const summary = screen.getByRole("region", { name: "Code review findings" });
  expect(within(summary).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Blocking1", "Should fix1", "Follow-up1"]);
  expect(within(within(summary).getByRole("region", { name: "Blocking" })).getByText("Crashes on an empty list.")).toBeInTheDocument();
  expect(within(within(summary).getByRole("region", { name: "Should fix" })).getByText("Name the constant.")).toBeInTheDocument();
  expect(within(within(summary).getByRole("region", { name: "Follow-up" })).getByText("Link the ADR.")).toBeInTheDocument();
});

/** The choice control of one finding, by where it is. */
const choiceOf = (where: string) => screen.getByRole("radiogroup", { name: `What to do with ${where}` });
const choose = (where: string, choice: "Fix now" | "Follow-up" | "Skip") => fireEvent.click(within(choiceOf(where)).getByRole("radio", { name: choice }));
const picked = (where: string) => within(choiceOf(where)).getByRole("radio", { checked: true }).textContent;
const tally = () => within(screen.getByRole("list", { name: "Choices" })).getAllByRole("listitem").map((li) => li.textContent);

test("each finding gets one choice: Blocking and Should fix start on Fix now, Follow-up on Follow-up, and the footer counts them", () => {
  render(<CodeReview {...props} findings={graded} />);
  expect(picked("src/b.ts:2")).toBe("Fix now");
  expect(picked("src/a.ts:10")).toBe("Fix now");
  expect(picked("docs/notes.md")).toBe("Follow-up");
  expect(tally()).toEqual(["Fix now 2", "Follow-up 1", "Skip 0"]);
  expect(screen.getByText("Takes the 1 Follow-up finding.")).toBeInTheDocument();
  expect(screen.getByText(/Fix now findings go back to coder-1 when you send the review\./)).toBeInTheDocument();

  choose("src/a.ts:10", "Skip");
  choose("src/b.ts:2", "Follow-up");
  expect(picked("src/a.ts:10")).toBe("Skip");
  expect(tally()).toEqual(["Fix now 0", "Follow-up 2", "Skip 1"]);
  expect(screen.getByText("Takes the 2 Follow-up findings.")).toBeInTheDocument();
  // A finding on a line in the diff carries its choice there too.
  expect(within(fileA()).getByText("Skip")).toBeInTheDocument();
});

test("Request changes sends the Fix now findings with the line comments and the overall comment", async () => {
  render(<CodeReview {...props} findings={graded} />);
  fireEvent.click(within(fileA()).getByRole("button", { name: "Select line 9" }));
  fireEvent.change(within(fileA()).getByLabelText("Comment on src/a.ts line 9"), { target: { value: "Explain this." } });
  fireEvent.click(within(fileA()).getByRole("button", { name: "Add comment" }));

  fireEvent.click(screen.getByRole("button", { name: "Submit review" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("Findings and comments go back to coder-1.");
  expect(dialog).toHaveTextContent("2 findings and 1 comment will be sent to coder-1.");
  const list = within(dialog).getByRole("list", { name: "Goes back to coder-1" });
  expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["b.ts:2Crashes on an empty list.", "a.ts:10Name the constant."]);
  fireEvent.change(screen.getByLabelText("Overall comment"), { target: { value: "Close." } });
  fireEvent.click(screen.getByRole("radio", { name: /Request changes/ }));
  expect(screen.getByRole("radio", { name: /Request changes/ })).toHaveAccessibleName(/Send the Fix now findings and your comments back to coder-1/);
  fireEvent.click(screen.getByRole("button", { name: "Send review" }));
  await waitFor(() =>
    expect(actions.answerReviewAction).toHaveBeenCalledWith({
      questionId: "q1",
      runId: "r1",
      option: "changes",
      note: "Close.",
      comments: [{ path: "src/a.ts", side: "new", line: 9, quote: "line 9", body: "Explain this." }],
      findings: [0, 1],
    }),
  );
});

test("Approve after fixes sends the Fix now findings alone, and says there is nothing to fix only with nothing to send", async () => {
  render(<CodeReview {...props} findings={graded} />);
  choose("src/a.ts:10", "Skip");
  choose("src/b.ts:2", "Follow-up");
  fireEvent.click(screen.getByRole("button", { name: "Submit review" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Nothing will be sent to coder-1 yet.");
  fireEvent.click(screen.getByRole("radio", { name: /Approve after fixes/ }));
  fireEvent.click(screen.getByRole("button", { name: "Send review" }));
  expect(await screen.findByText("Pick Fix now on a finding, or add a comment or an overall comment, so there is something to fix.")).toBeInTheDocument();
  expect(actions.answerReviewAction).not.toHaveBeenCalled();

  choose("src/b.ts:2", "Fix now");
  expect(screen.getByRole("dialog")).toHaveTextContent("1 finding will be sent to coder-1.");
  fireEvent.click(screen.getByRole("button", { name: "Send review" }));
  await waitFor(() => expect(actions.answerReviewAction).toHaveBeenCalledWith({ questionId: "q1", runId: "r1", option: "fix", note: "", comments: [], findings: [1] }));
});

test("Approve with Fix now findings picked warns they will not be sent and reads Approve anyway", async () => {
  render(<CodeReview {...props} findings={graded} />);
  fireEvent.click(screen.getByRole("button", { name: "Submit review" }));
  fireEvent.click(screen.getByRole("radio", { name: /^Approve Let the run go on/ }));
  expect(screen.getByRole("alert")).toHaveTextContent("The 2 Fix now findings will not be sent.");
  expect(screen.getByRole("alert")).toHaveTextContent("Approve lets the run go on as it is. Pick Approve after fixes to send them, or set them to Follow-up or Skip.");
  expect(screen.getByRole("dialog")).toHaveTextContent("Approve sends nothing back to coder-1.");
  expect(screen.queryByRole("list", { name: "Goes back to coder-1" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send review" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Approve anyway" }));
  await waitFor(() => expect(actions.answerReviewAction).toHaveBeenCalledWith({ questionId: "q1", runId: "r1", option: "approve", note: "", comments: [] }));
});

test("Create follow-up issue takes the Follow-up findings, and they then say which issue holds them", async () => {
  followUp.createFollowUpAction.mockResolvedValue({ ok: true, issue: { number: 57, url: "https://github.com/o/r/issues/57" } });
  render(<CodeReview {...props} findings={graded} />);
  choose("src/a.ts:10", "Follow-up");
  fireEvent.click(screen.getByRole("button", { name: "Create follow-up issue" }));
  await waitFor(() => expect(followUp.createFollowUpAction).toHaveBeenCalledTimes(1));
  expect(followUp.createFollowUpAction).toHaveBeenCalledWith({ runId: "r1", questionId: "q1", findings: [0, 2] });
  expect(await screen.findByRole("link", { name: "#57" })).toHaveAttribute("href", "https://github.com/o/r/issues/57");
  expect(screen.getByText(/has the 2 Follow-up findings\./)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Create follow-up issue" })).not.toBeInTheDocument();
  // The findings in the issue say so instead of offering a choice; the others stay editable.
  expect(screen.queryByRole("radiogroup", { name: "What to do with src/a.ts:10" })).not.toBeInTheDocument();
  expect(screen.getAllByText("In #57")).toHaveLength(2);
  expect(picked("src/b.ts:2")).toBe("Fix now");
});

test("an answered review does not say the Fix now findings go back, and its choices still pick a follow-up issue's findings", () => {
  render(<CodeReview {...props} findings={graded} answered={[]} />);
  expect(screen.queryByText(/Fix now findings go back/)).not.toBeInTheDocument();
  choose("src/a.ts:10", "Follow-up");
  expect(screen.getByText("Takes the 2 Follow-up findings.")).toBeInTheDocument();
});

test("a finding's choice survives leaving the page with the draft", () => {
  const { unmount } = render(<CodeReview {...props} findings={graded} />);
  choose("src/b.ts:2", "Skip");
  unmount();
  render(<CodeReview {...props} findings={graded} />);
  expect(picked("src/b.ts:2")).toBe("Skip");
});

test("a code review without findings says the reviewer found nothing", () => {
  render(<CodeReview {...props} findings={{ verdict: "approve", by: "code_review-1", comments: [] }} />);
  expect(screen.getByRole("heading", { name: "Code review found nothing" })).toBeInTheDocument();
});

function Grab({ onPort }: { onPort: (port: AssistantPort) => void }) {
  const port = useAssistant();
  useEffect(() => {
    onPort(port);
  }, [onPort, port]);
  return null;
}

/**
 * The code review inside the assistant, with a turn running so the test can call the page's tools as
 * the model would: `call` emits a ui_call and resolves with the page's answer.
 */
async function withAssistant(overrides: Partial<ComponentProps<typeof CodeReview>> = {}) {
  const transport = new FakeAssistantTransport();
  let port: AssistantPort | undefined;
  const onPort = (p: AssistantPort) => (port = p);
  render(
    <AssistantProvider transport={transport} available>
      <Grab onPort={onPort} />
      <CodeReview {...props} {...overrides} />
    </AssistantProvider>,
  );
  act(() => void port!.send("what is on this page"));
  await waitFor(() => expect(transport.turns).toHaveLength(1));
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  let next = 1;
  const call = async (name: string, args: unknown = {}) => {
    const requestId = `u${next++}`;
    act(() => transport.emit({ type: "ui_call", requestId, name, args }));
    await waitFor(() => expect(transport.uiReplies.find((r) => r.requestId === requestId)).toBeDefined());
    const { text, isError } = transport.uiReplies.find((r) => r.requestId === requestId)!;
    return { text, isError };
  };
  const whereAmI = async () => JSON.parse((await call("where_am_i")).text) as { page?: { kind: string; tools: { name: string }[]; state: { data: Record<string, unknown> } } };
  return { call, whereAmI, transport };
}

const fileCursor = () => screen.getByRole("button", { name: / of 3$/ });

test("page_go_to_file moves by path, index and direction, and opens the file", async () => {
  const { call, whereAmI } = await withAssistant();
  fireEvent.click(within(screen.getByRole("region", { name: "src/b.ts" })).getByRole("button", { name: "Collapse src/b.ts" }));

  expect(await call("page_go_to_file", { path: "src/b.ts" })).toEqual({ text: "Now on file 2 of 3: src/b.ts.", isError: false });
  expect(fileCursor()).toHaveTextContent("src/b.ts 2 of 3");
  expect(within(screen.getByRole("region", { name: "src/b.ts" })).getByText("export const b = 1;")).toBeInTheDocument();

  expect(await call("page_go_to_file", { index: 3 })).toEqual({ text: "Now on file 3 of 3: pnpm-lock.yaml.", isError: false });
  expect(await call("page_go_to_file", { direction: "previous" })).toEqual({ text: "Now on file 2 of 3: src/b.ts.", isError: false });
  expect(await call("page_go_to_file", { direction: "next" })).toEqual({ text: "Now on file 3 of 3: pnpm-lock.yaml.", isError: false });
  expect(await call("page_go_to_file")).toEqual({ text: "Already on the last file, 3 of 3: pnpm-lock.yaml.", isError: false });
  expect((await whereAmI()).page?.state.data).toMatchObject({ current: 3 });

  expect(await call("page_go_to_file", { path: "src/c.ts" })).toEqual({ text: "src/c.ts is not in this review. The files are: 1. src/a.ts; 2. src/b.ts; 3. pnpm-lock.yaml.", isError: true });
  expect(await call("page_go_to_file", { index: 4 })).toEqual({ text: "There is no file 4. The files run from 1 to 3.", isError: true });
  expect(fileCursor()).toHaveTextContent("pnpm-lock.yaml 3 of 3");
});

test("page_set_diff_view switches mode and layout", async () => {
  const { call, whereAmI } = await withAssistant();
  expect(within(fileA()).queryByText("line 1")).not.toBeInTheDocument();

  expect(await call("page_set_diff_view", { mode: "whole" })).toEqual({ text: "Showing the whole file, in one column.", isError: false });
  expect(screen.getByRole("radio", { name: "Whole file" })).toBeChecked();
  expect(within(fileA()).getByText("line 1")).toBeInTheDocument();

  expect(await call("page_set_diff_view", { layout: "split" })).toEqual({ text: "Showing the whole file, side by side.", isError: false });
  expect(screen.getByRole("radio", { name: "Split" })).toBeChecked();
  expect(within(within(fileA()).getByText("old 10").closest("tr")!).getByText("new 10")).toBeInTheDocument();

  expect(await call("page_set_diff_view", { mode: "changes", layout: "unified" })).toEqual({ text: "Showing the changes, in one column.", isError: false });
  expect(screen.getByRole("radio", { name: "Changes" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Unified" })).toBeChecked();
  expect((await whereAmI()).page?.state.data).toMatchObject({ mode: "changes", layout: "unified" });
});

test("page_comment_on_lines adds a draft comment with the quoted code, and a line outside the file is refused with its range", async () => {
  const { call, whereAmI } = await withAssistant();
  expect(await call("page_comment_on_lines", { path: "src/a.ts", line: 9, endLine: 11, body: "Explain this." })).toEqual({
    text: "Drafted a comment on lines 9 to 11 of src/a.ts. 1 comment drafted.",
    isError: false,
  });
  expect(within(fileA()).getByText("Explain this.")).toBeInTheDocument();
  expect(screen.getByText("1 comment drafted")).toBeInTheDocument();
  expect(await call("page_comment_on_lines", { path: "src/a.ts", line: 10, side: "old", body: "Why remove it?" })).toEqual({
    text: "Drafted a comment on old line 10 of src/a.ts. 2 comments drafted.",
    isError: false,
  });
  expect((await whereAmI()).page?.state.data).toMatchObject({
    comments: [
      { path: "src/a.ts", side: "new", line: 9, endLine: 11, quote: "line 9\nnew 10\nline 11", body: "Explain this." },
      { path: "src/a.ts", side: "old", line: 10, quote: "old 10", body: "Why remove it?" },
    ],
  });

  expect(await call("page_comment_on_lines", { path: "src/a.ts", line: 25, body: "Here?" })).toEqual({ text: "src/a.ts has no new line 25. Its new lines run from 1 to 20.", isError: true });
  expect(await call("page_comment_on_lines", { path: "src/b.ts", line: 1, endLine: 3, body: "Here?" })).toEqual({ text: "src/b.ts has no new line 3. Its new lines run from 1 to 2.", isError: true });
  expect(await call("page_comment_on_lines", { path: "src/b.ts", line: 1, side: "old", body: "Here?" })).toEqual({ text: "src/b.ts has no old lines to comment on.", isError: true });
  expect(await call("page_comment_on_lines", { path: "pnpm-lock.yaml", line: 1, body: "Here?" })).toEqual({ text: "pnpm-lock.yaml has no new lines to comment on.", isError: true });
  expect(await call("page_comment_on_lines", { path: "src/c.ts", line: 1, body: "Here?" })).toMatchObject({ text: expect.stringContaining("src/c.ts is not in this review."), isError: true });
  expect(screen.getByText("2 comments drafted")).toBeInTheDocument();
});

test("page_mark_viewed saves the mark and collapses the file", async () => {
  const { call, whereAmI } = await withAssistant();
  expect(await call("page_mark_viewed", { path: "src/a.ts", viewed: true })).toEqual({ text: "Marked src/a.ts as viewed and collapsed it. 1 of 3 viewed.", isError: false });
  expect(actions.markViewedAction).toHaveBeenCalledWith({ runId: "r1", path: "src/a.ts", blobSha: "b1", viewed: true });
  expect(within(fileA()).getByRole("checkbox", { name: "Viewed" })).toBeChecked();
  expect(within(fileA()).queryByText("new 10")).not.toBeInTheDocument();
  expect((await whereAmI()).page?.state.data).toMatchObject({ files: [{ index: 1, path: "src/a.ts", viewed: true, open: false }, { path: "src/b.ts", viewed: false, open: true }, { path: "pnpm-lock.yaml" }] });

  expect(await call("page_mark_viewed", { path: "src/a.ts", viewed: false })).toEqual({ text: "Marked src/a.ts as not viewed and expanded it. 0 of 3 viewed.", isError: false });
  expect(within(fileA()).getByRole("checkbox", { name: "Viewed" })).not.toBeChecked();
  expect(within(fileA()).getByText("new 10")).toBeInTheDocument();

  // A file the review shows no content of has no Viewed box.
  expect(await call("page_mark_viewed", { path: "pnpm-lock.yaml", viewed: true })).toEqual({ text: "pnpm-lock.yaml cannot be marked viewed: the review does not show its content.", isError: true });
  // What the save refuses comes back as the tool's error.
  actions.markViewedAction.mockResolvedValueOnce({ ok: false, error: "That file cannot be marked." });
  expect(await call("page_mark_viewed", { path: "src/b.ts", viewed: true })).toEqual({ text: "That file cannot be marked.", isError: true });
  expect(within(screen.getByRole("region", { name: "src/b.ts" })).getByRole("checkbox", { name: "Viewed" })).not.toBeChecked();
  expect(actions.markViewedAction).toHaveBeenCalledTimes(3);
});

/** What a server action that redirects rejects with in the browser, once Next has started the navigation. */
const redirectTo = (path: string) => Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;push;${path};303;` });

test("page_submit_review changes with no comment and no note is refused, and with a comment sends it", async () => {
  const { call, whereAmI } = await withAssistant();
  for (const option of ["changes", "fix"]) {
    expect(await call("page_submit_review", { option })).toEqual({ text: "Add a comment or an overall comment first, so there is something to fix.", isError: true });
  }
  expect(actions.answerReviewAction).not.toHaveBeenCalled();

  await call("page_comment_on_lines", { path: "src/b.ts", line: 2, body: "Drop c." });
  expect(await call("page_set_note", { note: "Nearly there." })).toEqual({ text: 'Set the overall comment to "Nearly there."', isError: false });
  fireEvent.click(screen.getByRole("button", { name: "Submit review" }));
  expect(screen.getByLabelText("Overall comment")).toHaveValue("Nearly there.");
  expect((await whereAmI()).page?.state.data).toMatchObject({ note: "Nearly there." });

  // What the action refuses comes back as the tool's error, and the draft stays.
  actions.answerReviewAction.mockResolvedValueOnce({ ok: false, error: "This question was already answered." });
  expect(await call("page_submit_review", { option: "changes" })).toEqual({ text: "This question was already answered.", isError: true });
  expect(screen.getByText("1 comment drafted")).toBeInTheDocument();

  // On success the action redirects to the run page, which Next reports to the caller as a rejection.
  actions.answerReviewAction.mockRejectedValueOnce(redirectTo("/projects/p1/runs/r1"));
  expect(await call("page_submit_review", { option: "changes" })).toEqual({ text: "Requested changes from coder-1 with 1 comment and the overall comment. The run page opens.", isError: false });
  expect(actions.answerReviewAction).toHaveBeenLastCalledWith({
    questionId: "q1",
    runId: "r1",
    option: "changes",
    note: "Nearly there.",
    comments: [{ path: "src/b.ts", side: "new", line: 2, quote: "export const c = 2;", body: "Drop c." }],
  });
});

test("an answered review binds only navigation and view tools", async () => {
  const answered = [{ path: "src/a.ts", side: "new" as const, line: 10, quote: "new 10", body: "Name it." }];
  const { call, whereAmI } = await withAssistant({ answered });
  const page = (await whereAmI()).page!;
  expect(page.tools.map((t) => t.name)).toEqual(["page_go_to_file", "page_set_diff_view", "page_expand_files"]);
  expect(page.state.data).toMatchObject({ readOnly: true, comments: answered });

  expect(await call("page_go_to_file", { index: 2 })).toEqual({ text: "Now on file 2 of 3: src/b.ts.", isError: false });
  expect(await call("page_set_diff_view", { layout: "split" })).toEqual({ text: "Showing the changes, side by side.", isError: false });

  expect(await call("page_expand_files", { all: false })).toEqual({ text: "Collapsed every file.", isError: false });
  expect(within(fileA()).queryByText("new 10")).not.toBeInTheDocument();
  expect(await call("page_expand_files", { path: "src/a.ts", open: true })).toEqual({ text: "Expanded src/a.ts.", isError: false });
  expect(within(fileA()).getByText("new 10")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "src/b.ts" })).queryByText("export const b = 1;")).not.toBeInTheDocument();
  expect(await call("page_expand_files", { path: "src/a.ts", open: false })).toEqual({ text: "Collapsed src/a.ts.", isError: false });
  expect(await call("page_expand_files", { all: true })).toEqual({ text: "Expanded every file.", isError: false });
  expect(within(screen.getByRole("region", { name: "src/b.ts" })).getByText("export const b = 1;")).toBeInTheDocument();
  expect(await call("page_expand_files")).toEqual({ text: "Say all, or a path with open.", isError: true });

  for (const name of ["page_mark_viewed", "page_comment_on_lines", "page_remove_line_comment", "page_set_note", "page_submit_review"]) {
    expect(await call(name, { path: "src/a.ts", line: 9, viewed: true, body: "x", note: "x", option: "approve" })).toMatchObject({ isError: true, text: expect.stringContaining(`${name} is not available here`) });
  }
  expect(actions.answerReviewAction).not.toHaveBeenCalled();
  expect(actions.markViewedAction).not.toHaveBeenCalled();
});

test("page_remove_line_comment removes the drafted comment that starts at a line, and names the drafted ones when none does", async () => {
  const { call } = await withAssistant();
  await call("page_comment_on_lines", { path: "src/a.ts", line: 9, endLine: 11, body: "Explain this." });
  await call("page_comment_on_lines", { path: "src/b.ts", line: 1, body: "Fine." });
  expect(await call("page_remove_line_comment", { path: "src/a.ts", line: 10 })).toEqual({
    text: "No drafted comment starts at line 10 of src/a.ts. The drafted comments are on: src/a.ts lines 9 to 11; src/b.ts line 1.",
    isError: true,
  });
  expect(await call("page_remove_line_comment", { path: "src/a.ts", line: 9 })).toEqual({ text: "Removed the comment on lines 9 to 11 of src/a.ts. 1 comment drafted.", isError: false });
  expect(within(fileA()).queryByText("Explain this.")).not.toBeInTheDocument();
  expect(screen.getByText("1 comment drafted")).toBeInTheDocument();
});

test("where_am_i lists the code reviewer's findings by severity and says the follow-up issue is the page's button", async () => {
  const { whereAmI } = await withAssistant({ findings: graded });
  expect((await whereAmI()).page?.state.data).toMatchObject({
    findings: {
      by: "code_review-1",
      verdict: "request_changes",
      items: [
        { index: 1, severity: "should_fix", path: "src/a.ts", line: 10, body: "Name the constant.", choice: "fix_now" },
        { index: 2, severity: "blocking", path: "src/b.ts", line: 2, body: "Crashes on an empty list.", choice: "fix_now" },
        { index: 3, severity: "follow_up", path: "docs/notes.md", body: "Link the ADR.", choice: "follow_up" },
      ],
      followUp: null,
      followUpNote: "The person opens a follow-up issue from the Follow-up findings with the Create follow-up issue button. No page tool does it.",
    },
  });

  followUp.createFollowUpAction.mockResolvedValue({ ok: true, issue: { number: 57, url: "https://github.com/o/r/issues/57" } });
  fireEvent.click(screen.getByRole("button", { name: "Create follow-up issue" }));
  expect(await screen.findByRole("link", { name: "#57" })).toBeInTheDocument();
  expect((await whereAmI()).page?.state.data).toMatchObject({ findings: { followUp: { number: 57, url: "https://github.com/o/r/issues/57" } } });
});

test("page_set_finding_choice changes a finding's choice, and page_submit_review sends the Fix now findings", async () => {
  const { call, whereAmI } = await withAssistant({ findings: graded });
  expect(await call("page_set_finding_choice", { index: 1, choice: "skip" })).toEqual({ text: "Set finding 1, src/a.ts:10, to Skip. Fix now 1, Follow-up 1, Skip 1.", isError: false });
  expect(picked("src/a.ts:10")).toBe("Skip");
  expect(await call("page_set_finding_choice", { index: 4, choice: "skip" })).toEqual({ text: "There is no finding 4. The findings run from 1 to 3.", isError: true });
  expect((await whereAmI()).page?.state.data).toMatchObject({ findings: { items: [{ index: 1, choice: "skip" }, { index: 2, choice: "fix_now" }, { index: 3, choice: "follow_up" }] } });

  actions.answerReviewAction.mockRejectedValueOnce(redirectTo("/projects/p1/runs/r1"));
  expect(await call("page_submit_review", { option: "fix" })).toEqual({ text: "Approved after fixes: sent 1 finding back to coder-1. The run page opens.", isError: false });
  expect(actions.answerReviewAction).toHaveBeenLastCalledWith({ questionId: "q1", runId: "r1", option: "fix", note: "", comments: [], findings: [1] });
});

test("page_submit_review with only Follow-up and skipped findings and nothing typed is refused", async () => {
  const { call } = await withAssistant({ findings: graded });
  await call("page_set_finding_choice", { index: 1, choice: "follow_up" });
  await call("page_set_finding_choice", { index: 2, choice: "skip" });
  expect(await call("page_submit_review", { option: "changes" })).toEqual({ text: "Pick Fix now on a finding, or add a comment or an overall comment, so there is something to fix.", isError: true });
  expect(actions.answerReviewAction).not.toHaveBeenCalled();
});
