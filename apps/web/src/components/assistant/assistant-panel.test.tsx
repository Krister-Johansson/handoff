import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { usePageTools } from "@/lib/assistant/use-page-tools";
import { FakeAssistantTransport, fakeChat } from "@/lib/assistant/testing/fake-assistant-transport";
import { AssistantPanel } from "./assistant-panel";
import { AssistantProvider, OPEN_CHAT_KEY, useAssistantPanel } from "./assistant-provider";
import { VoiceButton } from "@/components/voice/voice-button";
import { VoiceProvider } from "@/components/voice/voice-provider";
import type { RecognitionCtor } from "@/lib/voice/support";
import { FakeSpeechRecognition } from "@/lib/voice/testing/fake-speech-recognition";
import { AppShell } from "@/components/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/projects" }));

let transport: FakeAssistantTransport;
beforeEach(() => {
  transport = new FakeAssistantTransport();
  Element.prototype.scrollIntoView = vi.fn();
  push.mockReset();
  window.history.replaceState({}, "", "/projects");
});

function App({ page = "Projects", available = true, offReason, children }: { page?: string; available?: boolean; offReason?: "no-token" | "off"; children?: ReactNode }) {
  return (
    <AssistantProvider transport={transport} available={available} {...(offReason ? { offReason } : {})}>
      <main>
        <h1>{page}</h1>
        {children}
      </main>
      <AssistantPanel />
    </AssistantProvider>
  );
}

async function openAndSend(text: string) {
  fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
  const composer = await screen.findByLabelText("Message the assistant");
  fireEvent.change(composer, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(transport.turns).toHaveLength(1));
}

const panel = () => screen.getByRole("dialog", { name: "Assistant" });

test("sending a message shows it and streams the reply as it arrives", async () => {
  render(<App />);
  await openAndSend("What needs me?");
  expect(transport.turns[0]).toMatchObject({ conversationId: "c1", text: "What needs me?", source: "typed" });
  // The message, and the new chat's title in the panel header.
  expect(within(panel()).getAllByText("What needs me?")).toHaveLength(2);
  expect(within(panel()).getByRole("heading", { level: 2, name: "What needs me?" })).toBeInTheDocument();
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  act(() => transport.emit({ type: "text", text: "Two runs " }));
  expect(within(panel()).getByText("Thinking")).toBeInTheDocument();
  act(() => transport.emit({ type: "text", text: "wait for you." }));
  expect(within(panel()).getByText("Two runs wait for you.")).toBeInTheDocument();
  act(() => transport.emit({ type: "done", text: "Two runs wait for you." }));
  await waitFor(() => expect(within(panel()).queryByText("Thinking")).not.toBeInTheDocument());
});

test("a tool call shows as a card with its title, summary and result", async () => {
  render(<App />);
  await openAndSend("How is run 7f3a?");
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  act(() => transport.emit({ type: "tool_call", id: "u1", name: "get_run", title: "Show a run", summary: "Show run 7f3a1b2c", args: { run_id: "7f3a1b2c" } }));
  const card = within(panel()).getByRole("group", { name: "Show a run" });
  expect(card).toHaveTextContent("Show run 7f3a1b2c");
  expect(card).toHaveTextContent("running");
  expect(within(panel()).getByText("Calling Show a run")).toBeInTheDocument();
  act(() => transport.emit({ type: "tool_result", id: "u1", result: '{"status":"waiting"}', isError: false }));
  expect(card).toHaveTextContent("done");
  expect(card).toHaveTextContent('{"status":"waiting"}');
});

const RUN_CARD = "ui://handoff/run-card.html";
const runCard = () => ({ uri: RUN_CARD, html: "<!doctype html><html><head></head><body></body></html>", prefersBorder: false, sandbox: "http://127.0.0.1:49152/sandbox?host=http%3A%2F%2Flocalhost%3A3000" });

test("a get_run call shows the run card under the tool rows and above the reply's text", async () => {
  transport.views.set(RUN_CARD, runCard());
  render(<App />);
  await openAndSend("How is run 7f3a?");
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  act(() => transport.emit({ type: "tool_call", id: "u1", name: "get_run", title: "Show a run", summary: "Show run 7f3a1b2c", args: { run_id: "7f3a1b2c" } }));
  act(() => transport.emit({ type: "tool_result", id: "u1", result: '{"id":"7f3a1b2c"}', isError: false }));
  act(() => transport.emit({ type: "done", text: "It runs the coder again." }));
  const frame = await within(panel()).findByTitle("Show run 7f3a1b2c");
  await waitFor(() => expect(frame).toHaveAttribute("src", runCard().sandbox));
  expect(transport.viewLoads).toEqual([RUN_CARD]);
  const row = within(panel()).getByRole("group", { name: "Show a run" });
  const text = within(panel()).getByText("It runs the coder again.");
  expect(row.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(frame.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("when a call's view cannot be read, the card goes and the row keeps its raw result", async () => {
  render(<App />);
  await openAndSend("How is run 7f3a?");
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  act(() => transport.emit({ type: "tool_call", id: "u1", name: "get_run", title: "Show a run", summary: "Show run 7f3a1b2c", args: { run_id: "7f3a1b2c" } }));
  act(() => transport.emit({ type: "tool_result", id: "u1", result: '{"id":"7f3a1b2c"}', isError: false }));
  await waitFor(() => expect(transport.viewLoads).toEqual([RUN_CARD]));
  await waitFor(() => expect(within(panel()).queryByTitle("Show run 7f3a1b2c")).not.toBeInTheDocument());
  expect(within(panel()).getByRole("group", { name: "Show a run" })).toHaveTextContent('{"id":"7f3a1b2c"}');
});

test("a failed get_run call keeps its row and draws no card", async () => {
  transport.views.set(RUN_CARD, runCard());
  render(<App />);
  await openAndSend("How is run nope?");
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  act(() => transport.emit({ type: "tool_call", id: "u1", name: "get_run", title: "Show a run", summary: "Show run nope", args: { run_id: "nope" } }));
  act(() => transport.emit({ type: "tool_result", id: "u1", result: "There is no run nope.", isError: true }));
  expect(within(panel()).getByRole("group", { name: "Show a run" })).toHaveTextContent("There is no run nope.");
  expect(within(panel()).queryByTitle("Show run nope")).not.toBeInTheDocument();
});

test("a reloaded chat draws the run card again from the stored result", async () => {
  transport.views.set(RUN_CARD, runCard());
  transport.conversations = [fakeChat({ id: "c9", title: "How is run 7f3a?" })];
  transport.stored.set("c9", {
    conversation: { ...transport.conversations[0]!, turnId: null },
    messages: [
      { id: "m1", role: "user", content: { text: "How is run 7f3a?", source: "typed" } },
      { id: "m2", role: "assistant", content: { text: "It runs.", calls: [{ id: "u1", name: "get_run", args: { run_id: "7f3a1b2c" }, result: '{"id":"7f3a1b2c"}' }], outcome: "done" } },
    ],
  });
  window.localStorage.setItem(OPEN_CHAT_KEY, "c9");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
  const frame = await within(panel()).findByTitle("Show run 7f3a1b2c");
  await waitFor(() => expect(frame).toHaveAttribute("src", runCard().sandbox));
});

/** The panel's tool runner for views, as a card's frame reaches it. */
const viewTools: { call?: ReturnType<typeof useAssistantPanel>["callViewTool"] } = {};
const callViewTool: ReturnType<typeof useAssistantPanel>["callViewTool"] = (...args) => viewTools.call!(...args);
function GrabViewTools() {
  const { callViewTool: call } = useAssistantPanel();
  useEffect(() => {
    viewTools.call = call;
  }, [call]);
  return null;
}

/** A reply with a run card for call u1, which a view's tool call can then come from. */
async function replyWithCard() {
  transport.views.set(RUN_CARD, runCard());
  render(
    <App>
      <GrabViewTools />
    </App>,
  );
  await openAndSend("How is run 7f3a?");
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  act(() => transport.emit({ type: "tool_call", id: "u1", name: "get_run", title: "Show a run", summary: "Show run 7f3a1b2c", args: { run_id: "7f3a1b2c" } }));
  act(() => transport.emit({ type: "tool_result", id: "u1", result: '{"id":"7f3a1b2c"}', isError: false }));
  act(() => transport.emit({ type: "done", text: "It runs." }));
  return within(panel()).findByTitle("Show run 7f3a1b2c");
}

const RUN = "7f3a1b2c-0000-4000-8000-000000000000";

test("a view's call of a tool that needs approval puts an approval card under the view's card, and runs only after Approve", async () => {
  transport.toolResults.set("cancel_run", { id: RUN, status: "cancelled" });
  const frame = await replyWithCard();
  let result: unknown;
  act(() => void callViewTool("u1", { name: "cancel_run", arguments: { run_id: RUN } }).then((r) => (result = r)));
  const card = await within(panel()).findByRole("group", { name: "Approve: Cancel a run" });
  expect(within(card).getByText("Cancel run 7f3a1b2c")).toBeInTheDocument();
  expect(frame.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // The click in the view asked; nothing runs until the person approves here.
  expect(transport.toolCalls).toEqual([]);
  expect(within(panel()).queryByText("A browser agent asks")).not.toBeInTheDocument();
  fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
  await waitFor(() => expect(result).toEqual({ content: [{ type: "text", text: JSON.stringify({ id: RUN, status: "cancelled" }, null, 2) }] }));
  expect(transport.toolCalls).toEqual([{ name: "cancel_run", args: { run_id: RUN } }]);
});

test("a view's call the person denies does not run, and the view hears the note", async () => {
  await replyWithCard();
  let result: unknown;
  act(() => void callViewTool("u1", { name: "cancel_run", arguments: { run_id: RUN } }).then((r) => (result = r)));
  const card = await within(panel()).findByRole("group", { name: "Approve: Cancel a run" });
  fireEvent.click(within(card).getByRole("button", { name: "Deny" }));
  await waitFor(() => expect(result).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringMatching(/^The person did not approve this/) }] }));
  expect(transport.toolCalls).toEqual([]);
});

test("a view's call of a read-only tool runs at once, without an approval card", async () => {
  transport.toolResults.set("get_run", { id: RUN, status: "running" });
  await replyWithCard();
  let result: unknown;
  act(() => void callViewTool("u1", { name: "get_run", arguments: { run_id: RUN } }).then((r) => (result = r)));
  await waitFor(() => expect(result).toEqual({ content: [{ type: "text", text: JSON.stringify({ id: RUN, status: "running" }, null, 2) }] }));
  expect(transport.toolCalls).toEqual([{ name: "get_run", args: { run_id: RUN } }]);
  expect(within(panel()).queryByRole("group", { name: /^Approve:/ })).not.toBeInTheDocument();
});

test("when the view's card goes, its open approval counts as denied", async () => {
  await replyWithCard();
  const controller = new AbortController();
  let result: unknown;
  act(() => void callViewTool("u1", { name: "cancel_run", arguments: { run_id: RUN } }, controller.signal).then((r) => (result = r)));
  await within(panel()).findByRole("group", { name: "Approve: Cancel a run" });
  act(() => controller.abort());
  await waitFor(() => expect(within(panel()).queryByRole("group", { name: "Approve: Cancel a run" })).not.toBeInTheDocument());
  expect(result).toMatchObject({ isError: true });
  expect(transport.toolCalls).toEqual([]);
});

test("an approval card takes focus, and nothing is sent until Approve is clicked; Enter in the note does not approve", async () => {
  render(<App />);
  await openAndSend("Cancel run 7f3a");
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  act(() => transport.emit({ type: "confirm", requestId: "r1", toolUseId: "u1", name: "cancel_run", title: "Cancel a run", summary: "Cancel run 7f3a1b2c", args: { run_id: "7f3a1b2c" } }));
  const card = within(panel()).getByRole("group", { name: "Approve: Cancel a run" });
  await waitFor(() => expect(card).toHaveFocus());
  expect(card).toHaveTextContent("Cancel run 7f3a1b2c");
  expect(within(panel()).getByText("Waiting for your approval")).toBeInTheDocument();
  const note = within(card).getByLabelText("Note (optional)");
  fireEvent.change(note, { target: { value: "sure" } });
  fireEvent.keyDown(note, { key: "Enter" });
  expect(transport.replies).toEqual([]);
  fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
  await waitFor(() => expect(transport.replies).toEqual([{ turnId: "t1", requestId: "r1", approved: true }]));
  act(() => transport.emit({ type: "confirmed", requestId: "r1", approved: true }));
  expect(card).toHaveTextContent("Approved");
});

test("Deny sends the note", async () => {
  render(<App />);
  await openAndSend("Cancel run 7f3a");
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  act(() => transport.emit({ type: "confirm", requestId: "r1", toolUseId: "u1", name: "cancel_run", title: "Cancel a run", summary: "Cancel run 7f3a1b2c", args: {} }));
  const card = within(panel()).getByRole("group", { name: "Approve: Cancel a run" });
  fireEvent.change(within(card).getByLabelText("Note (optional)"), { target: { value: "Let it finish." } });
  fireEvent.click(within(card).getByRole("button", { name: "Deny" }));
  await waitFor(() => expect(transport.replies).toEqual([{ turnId: "t1", requestId: "r1", approved: false, note: "Let it finish." }]));
});

test("Stop ends the streaming reply and marks it stopped", async () => {
  render(<App />);
  await openAndSend("Summarise every run");
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  act(() => transport.emit({ type: "text", text: "Run one " }));
  fireEvent.click(within(panel()).getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(transport.stops).toEqual(["t1"]));
  act(() => transport.emit({ type: "interrupted", text: "Run one " }));
  expect(await within(panel()).findByText("Stopped")).toBeInTheDocument();
  expect(within(panel()).getByRole("button", { name: "Send" })).toBeInTheDocument();
});

test("the panel stays open with its messages across a navigation", async () => {
  const { rerender } = render(<App page="Projects" />);
  await openAndSend("Open the inbox");
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  act(() => transport.emit({ type: "done", text: "Opened the Inbox." }));
  rerender(<App page="Inbox" />);
  expect(screen.getByRole("heading", { level: 1, name: "Inbox" })).toBeInTheDocument();
  expect(within(panel()).getByText("Opened the Inbox.")).toBeInTheDocument();
  expect(within(panel()).getAllByText("Open the inbox")).toHaveLength(2);
});

test("the panel header shows the open chat's title and project, starts a new chat, and has no history button", async () => {
  const chat = fakeChat({ id: "c8", title: "What failed?", project: { id: "p1", name: "handoff" } });
  transport.conversations = [chat];
  transport.stored.set("c8", {
    conversation: { ...chat, turnId: null },
    messages: [
      { id: "m1", role: "user", content: { text: "What failed?", source: "typed" } },
      { id: "m2", role: "assistant", content: { text: "The coder of run 7f3a failed.", calls: [], outcome: "done" } },
    ],
  });
  localStorage.setItem(OPEN_CHAT_KEY, "c8");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
  expect(await within(panel()).findByText("The coder of run 7f3a failed.")).toBeInTheDocument();
  expect(within(panel()).getByRole("heading", { level: 2, name: "What failed?" })).toBeInTheDocument();
  expect(within(panel()).getByText("handoff")).toBeInTheDocument();
  expect(within(panel()).queryByRole("button", { name: "Conversations" })).not.toBeInTheDocument();

  fireEvent.click(within(panel()).getByRole("button", { name: "New chat" }));
  expect(within(panel()).getByRole("heading", { level: 2, name: "New chat" })).toBeInTheDocument();
  expect(within(panel()).queryByText("The coder of run 7f3a failed.")).not.toBeInTheDocument();
  expect(localStorage.getItem(OPEN_CHAT_KEY)).toBeNull();
});

test("a chat outside any project says All projects under its title", async () => {
  const chat = fakeChat({ id: "c3", title: "What needs me this week" });
  transport.conversations = [chat];
  localStorage.setItem(OPEN_CHAT_KEY, "c3");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
  expect(await within(panel()).findByRole("heading", { level: 2, name: "What needs me this week" })).toBeInTheDocument();
  expect(within(panel()).getByText("All projects")).toBeInTheDocument();
});

test("Mod+J opens the panel and focuses the composer, and Escape closes it when the composer is empty", async () => {
  render(<App />);
  fireEvent.keyDown(window, { key: "j", metaKey: true });
  const composer = await screen.findByLabelText("Message the assistant");
  await waitFor(() => expect(composer).toHaveFocus());
  fireEvent.change(composer, { target: { value: "half a thought" } });
  fireEvent.keyDown(composer, { key: "Escape" });
  expect(screen.getByRole("dialog", { name: "Assistant" })).toBeInTheDocument();
  fireEvent.change(composer, { target: { value: "" } });
  fireEvent.keyDown(composer, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Assistant" })).not.toBeInTheDocument());
});

test("without a token the button explains that the assistant is off", async () => {
  render(<App available={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
  expect(await within(panel()).findByText(/The assistant is off/)).toBeInTheDocument();
  expect(within(panel()).getByText(/CLAUDE_CODE_OAUTH_TOKEN/)).toBeInTheDocument();
  expect(within(panel()).queryByLabelText("Message the assistant")).not.toBeInTheDocument();
});

test("after a navigation tool the page heading has focus and the panel says where it went", async () => {
  const { rerender } = render(<App page="Projects" />);
  await openAndSend("Open the inbox for sandbox");
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  push.mockImplementation((href: string) => window.history.pushState({}, "", href));
  act(() => transport.emit({ type: "tool_call", id: "u1", name: "go_to_inbox", title: "Open the Inbox", summary: "Open the Inbox for project p1", args: { project_id: "p1" } }));
  act(() => transport.emit({ type: "ui_call", requestId: "r1", name: "go_to_inbox", args: { project_id: "p1" } }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/inbox?project=p1"));
  rerender(<App page="Inbox" />);
  await waitFor(() => expect(transport.uiReplies).toEqual([{ turnId: "t1", requestId: "r1", text: "Opened Inbox (/inbox?project=p1).", isError: false }]));
  expect(screen.getByRole("heading", { level: 1, name: "Inbox" })).toHaveFocus();
  expect(within(panel()).getByText("Opened Inbox")).toBeInTheDocument();
  expect(panel()).toBeInTheDocument();
});

test("where_am_i reports the current path and title", async () => {
  window.history.replaceState({}, "", "/projects?tab=runs");
  document.title = "handoff";
  render(<App page="Projects" />);
  await openAndSend("What am I looking at?");
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  act(() => transport.emit({ type: "ui_call", requestId: "r1", name: "where_am_i", args: {} }));
  await waitFor(() => expect(transport.uiReplies).toHaveLength(1));
  expect(transport.uiReplies[0]).toMatchObject({ requestId: "r1", isError: false });
  expect(JSON.parse(transport.uiReplies[0]!.text)).toEqual({ path: "/projects?tab=runs", title: "handoff", heading: "Projects" });
});

test("a UI tool call to another site is refused without navigating", async () => {
  render(<App />);
  await openAndSend("Open example.com");
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  act(() => transport.emit({ type: "ui_call", requestId: "r1", name: "go_to", args: { path: "https://example.com/" } }));
  await waitFor(() => expect(transport.uiReplies).toHaveLength(1));
  expect(transport.uiReplies[0]).toMatchObject({ isError: true, text: expect.stringContaining("only opens pages of this dashboard") });
  expect(push).not.toHaveBeenCalled();
});

/** A stand-in for the browser's document.modelContext. */
function installModelContext() {
  const tools = new Map<string, { execute: (input: object, o: { signal: AbortSignal }) => Promise<unknown> }>();
  const context = Object.assign(new EventTarget(), {
    tools,
    registerTool: async (tool: { name: string; execute: (input: object, o: { signal: AbortSignal }) => Promise<unknown> }, options?: { signal?: AbortSignal }) => {
      tools.set(tool.name, tool);
      options?.signal?.addEventListener("abort", () => tools.delete(tool.name));
    },
    run: (name: string, input: object) => tools.get(name)!.execute(input, { signal: new AbortController().signal }),
  });
  Object.defineProperty(document, "modelContext", { value: context, configurable: true });
  return context;
}

test("a browser agent's confirm tool opens the panel with an approval card, and runs only after Approve", async () => {
  const context = installModelContext();
  const fetchMock = vi.fn(async () => Response.json({ result: { status: "cancelled" } }));
  vi.stubGlobal("fetch", fetchMock);
  try {
    render(<App />);
    await waitFor(() => expect(context.tools.has("cancel_run")).toBe(true));
    let result: unknown;
    act(() => void context.run("cancel_run", { run_id: "7f3a1b2c-0000-4000-8000-000000000000" }).then((r) => (result = r)));
    const card = await within(await screen.findByRole("dialog", { name: "Assistant" })).findByRole("group", { name: "Approve: Cancel a run" });
    expect(within(card).getByText("Cancel run 7f3a1b2c")).toBeInTheDocument();
    expect(within(panel()).getByText("A browser agent asks")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(result).toBe(JSON.stringify({ status: "cancelled" })));
    expect(fetchMock).toHaveBeenCalledWith("/api/assistant/tools/cancel_run", expect.objectContaining({ method: "POST" }));
  } finally {
    vi.unstubAllGlobals();
    delete (document as { modelContext?: unknown }).modelContext;
  }
});

/** A run page in miniature whose Show a view waits for `finish`, so the status line can be read while it runs. */
function RunViews({ finish }: { finish: Promise<void> }) {
  const [view, setView] = useState("steps");
  usePageTools(
    "run",
    {
      page_show_view: async ({ view }) => {
        await finish;
        setView(view);
        return `Showing the ${view} view.`;
      },
      page_open_step: undefined,
      page_close_step: undefined,
      page_pop_out: undefined,
      page_filter_events: undefined,
    },
    () => ({ view }),
  );
  return <p>Showing {view}</p>;
}

test("a browser agent's page tool call runs in the page and shows the agent's activity in the status line", async () => {
  const context = installModelContext();
  let finish = () => {};
  const finished = new Promise<void>((resolve) => (finish = resolve));
  try {
    const view = render(
      <App page="Add a CHANGELOG.md">
        <RunViews finish={finished} />
      </App>,
    );
    await waitFor(() => expect(context.tools.has("page_show_view")).toBe(true));
    expect(context.tools.has("page_open_step")).toBe(false);
    expect(context.tools.has("list_runs")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));

    let result: unknown;
    act(() => void context.run("page_show_view", { view: "graph" }).then((r) => (result = r)));
    expect(await within(panel()).findByText("A browser agent is using Show a view")).toBeInTheDocument();
    await act(async () => finish());
    await waitFor(() => expect(result).toBe("Showing the graph view."));
    expect(screen.getByText("Showing graph")).toBeInTheDocument();
    expect(within(panel()).queryByText("A browser agent is using Show a view")).not.toBeInTheDocument();

    // Leaving the page takes its tools off WebMCP; the catalog stays.
    view.rerender(<App page="Inbox" />);
    await waitFor(() => expect(context.tools.has("page_show_view")).toBe(false));
    expect(context.tools.has("list_runs")).toBe(true);
  } finally {
    delete (document as { modelContext?: unknown }).modelContext;
  }
});

test("with WebMCP switched off in this browser no tools register", async () => {
  localStorage.setItem("handoff.webmcp", "off");
  const context = installModelContext();
  try {
    render(<App />);
    await act(async () => {});
    expect(context.tools.size).toBe(0);
  } finally {
    localStorage.removeItem("handoff.webmcp");
    delete (document as { modelContext?: unknown }).modelContext;
  }
});

test("switched off in Settings, the panel says so and links to the setting", async () => {
  render(<App available={false} offReason="off" />);
  fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
  expect(await within(panel()).findByText((_, el) => el?.tagName === "P" && el.textContent === "It is switched off in Settings.")).toBeInTheDocument();
  expect(within(panel()).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings?tab=assistant");
  expect(within(panel()).queryByText(/CLAUDE_CODE_OAUTH_TOKEN/)).not.toBeInTheDocument();
});

test("a message asked by voice is marked Sent by voice", async () => {
  transport.conversations = [fakeChat({ id: "c8", title: "What needs me?", updatedAt: "2026-10-02T10:00:00Z" })];
  transport.stored.set("c8", {
    conversation: { ...transport.conversations[0]!, turnId: null },
    messages: [
      { id: "m1", role: "user", content: { text: "What needs me?", source: "voice" } },
      { id: "m2", role: "assistant", content: { text: "Nothing.", calls: [], outcome: "done" } },
      { id: "m3", role: "user", content: { text: "Thanks", source: "typed" } },
    ],
  });
  localStorage.setItem(OPEN_CHAT_KEY, "c8");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
  await within(panel()).findByText("Nothing.");
  expect(within(panel()).getAllByText("Sent by voice")).toHaveLength(1);
});

test("four or more tool calls fold under a summary row that opens them", async () => {
  render(<App />);
  await openAndSend("Why did the sandbox run fail?");
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  for (const [id, title] of [["u1", "List runs"], ["u2", "Show a run"], ["u3", "Show a run"], ["u4", "Show a project"]] as const) {
    act(() => transport.emit({ type: "tool_call", id, name: "x", title, summary: title, args: {} }));
    act(() => transport.emit({ type: "tool_result", id, result: id === "u2" ? "No run matches" : "{}", isError: id === "u2" }));
  }
  act(() => transport.emit({ type: "done", text: "It failed at tester." }));
  const summary = within(panel()).getByText("4 tool calls");
  expect(within(panel()).getByText("3 done, 1 failed")).toBeInTheDocument();
  expect(within(panel()).getByRole("group", { name: "Show a project" })).not.toBeVisible();
  fireEvent.click(summary);
  expect(within(panel()).getByRole("group", { name: "Show a project" })).toBeVisible();
});

test("an open approval card counts down to its timeout", async () => {
  render(<App />);
  await openAndSend("Cancel it");
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  try {
    act(() => transport.emit({ type: "turn", turnId: "t1" }));
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    act(() => transport.emit({ type: "confirm", requestId: "r1", toolUseId: "u1", name: "cancel_run", title: "Cancel a run", summary: "Cancel run 7f3a1b2c", args: { run_id: "7f3a1b2c" }, expiresAt }));
    const card = within(panel()).getByRole("group", { name: "Approve: Cancel a run" });
    expect(card).toHaveTextContent("5:00 left");
    act(() => vi.advanceTimersByTime(8_000));
    expect(card).toHaveTextContent("4:52 left");
  } finally {
    vi.useRealTimers();
  }
});

test("the composer shows Dictating while dictation goes into it", async () => {
  FakeSpeechRecognition.reset();
  render(
    <AssistantProvider transport={transport} available>
      <VoiceProvider support={{ recognition: FakeSpeechRecognition as unknown as RecognitionCtor, onDeviceCheck: true }}>
        <VoiceButton />
        <AssistantPanel />
      </VoiceProvider>
    </AssistantProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
  const composer = await screen.findByLabelText("Message the assistant");
  composer.focus();
  fireEvent.mouseDown(screen.getByRole("button", { name: "Listen" }));
  fireEvent.click(screen.getByRole("button", { name: "Listen" }));
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(1));
  act(() => FakeSpeechRecognition.instances[0]!.emitStart());
  expect(within(panel()).getByText("Dictating")).toBeInTheDocument();
});

/** A window of the given width: media queries with min-width and max-width match against it, and listeners hear a resize. */
function windowWidth(initial: number) {
  let width = initial;
  const lists = new Set<{ listeners: Set<() => void> }>();
  const matches = (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    return (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
  };
  vi.stubGlobal("matchMedia", (query: string) => {
    const entry = { listeners: new Set<() => void>() };
    lists.add(entry);
    return {
      get matches() {
        return matches(query);
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => entry.listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => entry.listeners.delete(fn),
    };
  });
  return {
    set(next: number) {
      width = next;
      for (const entry of lists) for (const fn of entry.listeners) fn();
    },
  };
}

vi.mock("@/components/notification-bell", () => ({ NotificationBell: () => <button type="button">Notifications</button> }));
vi.mock("@/components/voice/voice-transcript", () => ({ VoiceTranscript: () => null }));

test("from 1280 px the panel docks and the page narrows; below it floats over the page", async () => {
  const width = windowWidth(1440);
  try {
    render(
      <AssistantProvider transport={transport} available>
        <VoiceProvider support={{ recognition: undefined, onDeviceCheck: false }}>
          <TooltipProvider>
            <AppShell sidebarOpen sidebar={null} panel={<AssistantPanel />}>
              <main>
                <h1>Inbox</h1>
              </main>
            </AppShell>
          </TooltipProvider>
        </VoiceProvider>
      </AssistantProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    // Docked, the panel is a column beside the page under the top bar, not a dialog over it.
    const docked = await screen.findByRole("complementary", { name: "Assistant" });
    expect(screen.queryByRole("dialog", { name: "Assistant" })).not.toBeInTheDocument();
    const page = document.getElementById("content")!;
    expect(docked.parentElement).toContainElement(page);
    expect(docked).not.toContainElement(page);
    expect(document.querySelector("[data-slot=top-bar]")).not.toContainElement(docked);
    expect(within(docked).getByLabelText("Message the assistant")).toBeInTheDocument();
    fireEvent.click(within(docked).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary", { name: "Assistant" })).not.toBeInTheDocument();

    // Narrower than 1280 px it floats over the page.
    act(() => width.set(1100));
    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    expect(await screen.findByRole("dialog", { name: "Assistant" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Assistant" })).not.toBeInTheDocument();
    // Widening the window docks the open panel.
    act(() => width.set(1300));
    expect(await screen.findByRole("complementary", { name: "Assistant" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Assistant" })).not.toBeInTheDocument();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("docked, the assist button hides while the panel is open, and closing gives it focus again", async () => {
  windowWidth(1440);
  try {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    const docked = await screen.findByRole("complementary", { name: "Assistant" });
    expect(screen.queryByRole("button", { name: /^Assistant/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide the assistant" })).not.toBeInTheDocument();
    fireEvent.click(within(docked).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Assistant" })).toHaveFocus());

    // Escape in an empty composer closes the docked panel the same way.
    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    fireEvent.keyDown(await screen.findByLabelText("Message the assistant"), { key: "Escape" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Assistant" })).toHaveFocus());
  } finally {
    vi.unstubAllGlobals();
  }
});

test("floating, the assist button turns into Hide while the panel is open", async () => {
  windowWidth(1024);
  try {
    render(<App />);
    const button = screen.getByRole("button", { name: "Assistant" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    const floating = await screen.findByRole("dialog", { name: "Assistant" });
    expect(floating).toHaveAttribute("data-variant", "float");
    const hide = screen.getAllByRole("button", { name: "Hide the assistant" }).find((b) => !floating.contains(b))!;
    expect(hide).toHaveAttribute("aria-expanded", "true");
    // The panel's own Hide is a minus in its header.
    expect(within(floating).getByRole("button", { name: "Hide the assistant" })).toBeInTheDocument();
    fireEvent.click(hide);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Assistant" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Assistant" })).toHaveFocus();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("on a phone the panel fills the width under the top bar and the assist button waits until it closes", async () => {
  windowWidth(390);
  try {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    const phone = await screen.findByRole("dialog", { name: "Assistant" });
    expect(phone).toHaveAttribute("data-variant", "phone");
    expect(screen.queryByRole("button", { name: /^Assistant|Hide the assistant/ })).not.toBeInTheDocument();
    fireEvent.click(within(phone).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Assistant" })).toBeInTheDocument());
  } finally {
    vi.unstubAllGlobals();
  }
});

test("a dot on the assist button says an approval waits in some chat", async () => {
  transport.conversations = [fakeChat({ id: "c2", title: "Repair the docs build", state: "approval" })];
  function Sidebar() {
    const panel = useAssistantPanel();
    const { refreshChats } = panel;
    useEffect(() => void refreshChats(), [refreshChats]);
    return null;
  }
  render(
    <App>
      <Sidebar />
    </App>,
  );
  expect(await screen.findByRole("button", { name: "Assistant, an approval waits" })).toBeInTheDocument();
});

test("the composer's microphone dictates into the message box and keeps focus there", async () => {
  FakeSpeechRecognition.reset();
  render(
    <AssistantProvider transport={transport} available>
      <VoiceProvider support={{ recognition: FakeSpeechRecognition as unknown as RecognitionCtor, onDeviceCheck: true }}>
        <AssistantPanel />
      </VoiceProvider>
    </AssistantProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
  const composer = await screen.findByLabelText("Message the assistant");
  await waitFor(() => expect(composer).toHaveFocus());
  expect(within(panel()).getByText(/sends.*dictates$/)).toBeInTheDocument();
  const mic = within(panel()).getByRole("button", { name: "Dictate" });
  fireEvent.mouseDown(mic);
  fireEvent.click(mic);
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(1));
  act(() => FakeSpeechRecognition.instances[0]!.emitStart());
  expect(composer).toHaveFocus();
  expect(within(panel()).getByText("Dictating")).toBeInTheDocument();
  const stop = within(panel()).getByRole("button", { name: "Stop dictating" });
  expect(stop).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(stop);
  await waitFor(() => expect(FakeSpeechRecognition.instances[0]!.stopped).toBe(true));
});
