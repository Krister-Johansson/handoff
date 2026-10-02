import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { FakeAssistantTransport } from "@/lib/assistant/testing/fake-assistant-transport";
import { AssistantButton } from "./assistant-button";
import { AssistantProvider } from "./assistant-provider";
import { AssistantSheet } from "./assistant-sheet";
import { VoiceButton } from "@/components/voice/voice-button";
import { VoiceProvider } from "@/components/voice/voice-provider";
import type { RecognitionCtor } from "@/lib/voice/support";
import { FakeSpeechRecognition } from "@/lib/voice/testing/fake-speech-recognition";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/projects" }));

let transport: FakeAssistantTransport;
beforeEach(() => {
  transport = new FakeAssistantTransport();
  Element.prototype.scrollIntoView = vi.fn();
  push.mockReset();
  window.history.replaceState({}, "", "/projects");
});

function App({ page = "Projects", available = true, offReason }: { page?: string; available?: boolean; offReason?: "no-token" | "off" }) {
  return (
    <AssistantProvider transport={transport} available={available} {...(offReason ? { offReason } : {})}>
      <AssistantButton />
      <main>
        <h1>{page}</h1>
      </main>
      <AssistantSheet />
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
  expect(within(panel()).getByText("What needs me?")).toBeInTheDocument();
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
  expect(within(panel()).getByText("Open the inbox")).toBeInTheDocument();
});

test("the picker lists earlier conversations newest first and opens one", async () => {
  transport.conversations = [
    { id: "c9", title: "Merge the queue", updatedAt: "2026-10-01T12:00:00Z" },
    { id: "c8", title: "What failed?", updatedAt: "2026-10-01T10:00:00Z" },
  ];
  transport.stored.set("c8", {
    conversation: transport.conversations[1]!,
    messages: [
      { id: "m1", role: "user", content: { text: "What failed?", source: "typed" } },
      { id: "m2", role: "assistant", content: { text: "The coder of run 7f3a failed.", calls: [], outcome: "done" } },
    ],
  });
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
  fireEvent.click(await within(panel()).findByRole("button", { name: "Conversations" }));
  // The picker opens in a popover, outside the sheet.
  const list = await screen.findByRole("list", { name: "Conversations" });
  expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual([expect.stringContaining("Merge the queue"), expect.stringContaining("What failed?")]);
  fireEvent.click(within(list).getByRole("button", { name: /What failed\?/ }));
  expect(await within(panel()).findByText("The coder of run 7f3a failed.")).toBeInTheDocument();
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
  transport.conversations = [{ id: "c8", title: "What needs me?", updatedAt: "2026-10-02T10:00:00Z" }];
  transport.stored.set("c8", {
    conversation: transport.conversations[0]!,
    messages: [
      { id: "m1", role: "user", content: { text: "What needs me?", source: "voice" } },
      { id: "m2", role: "assistant", content: { text: "Nothing.", calls: [], outcome: "done" } },
      { id: "m3", role: "user", content: { text: "Thanks", source: "typed" } },
    ],
  });
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
  fireEvent.click(await within(panel()).findByRole("button", { name: "Conversations" }));
  fireEvent.click(within(await screen.findByRole("list", { name: "Conversations" })).getByRole("button", { name: /What needs me\?/ }));
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
        <AssistantButton />
        <VoiceButton />
        <AssistantSheet />
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
