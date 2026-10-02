import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { AssistantProvider, useAssistant } from "@/components/assistant/assistant-provider";
import type { AssistantPort } from "@/lib/assistant/port";
import { FakeAssistantTransport } from "@/lib/assistant/testing/fake-assistant-transport";
import { PlanReview } from "./plan-review";

const actions = vi.hoisted(() => ({ answerReviewAction: vi.fn() }));
vi.mock("@/app/inbox/actions", () => actions);
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/projects/p1/runs/r1/review/q1",
}));
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

test("a selection offers comment, which moves to the comment box, and copy", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<PlanReview {...props} />);
  expect(screen.queryByRole("toolbar", { name: "Selection" })).not.toBeInTheDocument();
  select("a JSON file");
  const toolbar = screen.getByRole("toolbar", { name: "Selection" });
  fireEvent.click(within(toolbar).getByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalledWith("a JSON file");
  fireEvent.click(within(toolbar).getByRole("button", { name: "Comment" }));
  expect(screen.getByLabelText("Comment")).toHaveFocus();
  fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Use SQLite." } });
  fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
  expect(screen.queryByRole("toolbar", { name: "Selection" })).not.toBeInTheDocument();
  expect(screen.getByText("1 comment")).toBeInTheDocument();
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

function Grab({ onPort }: { onPort: (port: AssistantPort) => void }) {
  const port = useAssistant();
  useEffect(() => {
    onPort(port);
  }, [onPort, port]);
  return null;
}

/**
 * The plan review inside the assistant, with a turn running so the test can call the page's tools as
 * the model would: `call` emits a ui_call and resolves with the page's answer.
 */
async function withAssistant() {
  const transport = new FakeAssistantTransport();
  let port: AssistantPort | undefined;
  const onPort = (p: AssistantPort) => (port = p);
  render(
    <AssistantProvider transport={transport} available>
      <Grab onPort={onPort} />
      <PlanReview {...props} />
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
  return { call, whereAmI };
}

test("page_comment_on_passage adds a comment for a quote in the plan and refuses one that is not there", async () => {
  const { call, whereAmI } = await withAssistant();
  // Whitespace counts as it does in a selection: runs of it are one space.
  expect(await call("page_comment_on_passage", { quote: " a JSON\n file ", body: "Use SQLite instead." })).toEqual({ text: 'Drafted a comment on "a JSON file". 1 comment drafted.', isError: false });
  expect(screen.getByRole("list", { name: "Comments" })).toHaveTextContent("a JSON file");
  expect(screen.getByRole("list", { name: "Comments" })).toHaveTextContent("Use SQLite instead.");
  expect((await whereAmI()).page?.state.data).toMatchObject({ questionId: "q1", runId: "r1", from: "planner", comments: [{ quote: "a JSON file", body: "Use SQLite instead." }], note: "" });

  for (const quote of ["a SQLite file", "## Steps"]) {
    expect(await call("page_comment_on_passage", { quote, body: "Here?" })).toEqual({
      text: `"${quote}" is not in the plan. Quote the plan's text as the page shows it, without markdown.`,
      isError: true,
    });
  }
  expect(screen.getByText("1 comment")).toBeInTheDocument();
});

/** What a server action that redirects rejects with in the browser, once Next has started the navigation. */
const redirectTo = (path: string) => Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;push;${path};303;` });

test("page_submit_review approve sends approve", async () => {
  const { call } = await withAssistant();
  actions.answerReviewAction.mockRejectedValueOnce(redirectTo("/projects/p1/runs/r1"));
  expect(await call("page_submit_review", { option: "approve" })).toEqual({ text: "Approved. The run page opens.", isError: false });
  expect(actions.answerReviewAction).toHaveBeenCalledWith({ questionId: "q1", runId: "r1", option: "approve", note: "", comments: [] });
});

test("page_remove_comment and page_set_note change the drafts the page shows, and fix needs one of them", async () => {
  const { call } = await withAssistant();
  await call("page_comment_on_passage", { quote: "add a CLI", body: "A web page." });
  await call("page_comment_on_passage", { quote: "Add storage", body: "Fine." });
  expect(await call("page_remove_comment", { quote: "a CLI" })).toEqual({
    text: 'No drafted comment is on "a CLI". The drafted comments are on: "add a CLI"; "Add storage".',
    isError: true,
  });
  expect(await call("page_remove_comment", { quote: "Add storage" })).toEqual({ text: 'Removed the comment on "Add storage". 1 comment drafted.', isError: false });
  expect(screen.getByRole("list", { name: "Comments" })).not.toHaveTextContent("Fine.");
  expect(await call("page_set_note", { note: "Close." })).toEqual({ text: 'Set the overall comment to "Close."', isError: false });
  expect(screen.getByLabelText("Overall comment")).toHaveValue("Close.");

  expect(await call("page_remove_comment", { quote: "add a CLI" })).toMatchObject({ isError: false });
  expect(await call("page_set_note", { note: "" })).toEqual({ text: "Cleared the overall comment.", isError: false });
  expect(await call("page_submit_review", { option: "fix" })).toEqual({ text: "Add a comment or an overall comment first, so there is something to fix.", isError: true });
  expect(actions.answerReviewAction).not.toHaveBeenCalled();
});
