import { useEffect, type ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { AssistantProvider, useAssistantPanel } from "@/components/assistant/assistant-provider";
import { FakeAssistantTransport } from "@/lib/assistant/testing/fake-assistant-transport";
import { DEFAULT_VOICE_PREFS } from "@/lib/voice/prefs";
import { createSpeaker } from "@/lib/voice/speaker";
import type { RecognitionCtor } from "@/lib/voice/support";
import { FakeSpeechRecognition } from "@/lib/voice/testing/fake-speech-recognition";
import { FakePlayer } from "@/lib/voice/testing/fake-player";
import { VoiceBubble } from "./voice-bubble";
import { VoiceHotkeys } from "./voice-hotkeys";
import { VoiceProvider } from "./voice-provider";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/projects" }));

let transport: FakeAssistantTransport;
let synth: FakePlayer;

beforeEach(() => {
  FakeSpeechRecognition.reset();
  localStorage.clear();
  transport = new FakeAssistantTransport();
  synth = new FakePlayer();
  Element.prototype.scrollIntoView = vi.fn();
});

function App({ available = true, panel = false, children }: { available?: boolean; panel?: boolean; children?: ReactNode }) {
  const speaker = createSpeaker(synth, () => DEFAULT_VOICE_PREFS);
  return (
    <AssistantProvider transport={transport} available={available}>
      <VoiceProvider support={{ recognition: FakeSpeechRecognition as unknown as RecognitionCtor, onDeviceCheck: true }} speaker={speaker}>
        <VoiceHotkeys />
        <VoiceBubble />
        {panel && <AssistantPanel />}
        {children}
        <main>
          <h1>Projects</h1>
        </main>
      </VoiceProvider>
    </AssistantProvider>
  );
}

const recognizer = () => FakeSpeechRecognition.instances.at(-1)!;
const bubble = () => screen.getByRole("region", { name: "Voice assistant" });
const said = () => synth.spoken;
const pressCtrlM = () => fireEvent.keyDown(document.body, { key: "m", code: "KeyM", ctrlKey: true });

/** Presses Ctrl+M and says `text` as one utterance. */
async function ask(text: string) {
  const before = FakeSpeechRecognition.instances.length;
  pressCtrlM();
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(before + 1));
  act(() => recognizer().emitStart());
  act(() => recognizer().emitResult(text, true));
  act(() => recognizer().emitEnd());
}

test("Ctrl+M opens the bubble and the final transcript goes to the assistant with source voice", async () => {
  render(<App />);
  expect(screen.queryByRole("region", { name: "Voice assistant" })).not.toBeInTheDocument();
  pressCtrlM();
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(1));
  act(() => recognizer().emitStart());
  expect(bubble()).toHaveTextContent("Listening");
  act(() => recognizer().emitResult("what needs", false));
  expect(bubble()).toHaveTextContent("what needs");
  act(() => recognizer().emitResult("what needs me", true));
  act(() => recognizer().emitEnd());
  await waitFor(() => expect(transport.turns).toEqual([{ conversationId: "c1", text: "what needs me", source: "voice" }]));
  expect(bubble()).toHaveTextContent("what needs me");
  // The panel stays closed.
  expect(screen.queryByRole("dialog", { name: "Assistant" })).not.toBeInTheDocument();
});

test("nothing is sent while results are interim", async () => {
  render(<App />);
  pressCtrlM();
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(1));
  act(() => recognizer().emitStart());
  act(() => recognizer().emitResult("cancel every", false));
  fireEvent.keyDown(document.body, { key: "Escape" });
  await act(async () => {});
  expect(transport.turns).toEqual([]);
});

test("the bubble shows Thinking while the turn runs, then only the reply, and speaks it", async () => {
  render(<App />);
  await ask("what needs me");
  await waitFor(() => expect(transport.turns).toHaveLength(1));
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  expect(bubble()).toHaveTextContent("Thinking");
  // No tool rows and no tool names: the bubble says Thinking until the reply is done.
  act(() => transport.emit({ type: "tool_call", id: "u1", name: "list_attention", title: "List what needs attention", summary: "List what needs attention", args: {} }));
  expect(bubble()).toHaveTextContent("Thinking");
  expect(bubble()).not.toHaveTextContent("List what needs attention");
  act(() => transport.emit({ type: "tool_result", id: "u1", result: "[]", isError: false }));
  act(() => transport.emit({ type: "text", text: "Let me look. " }));
  expect(bubble()).not.toHaveTextContent("Let me look.");
  act(() => transport.emit({ type: "done", text: "Nothing needs you. All runs are fine." }));
  expect(bubble()).toHaveTextContent("Nothing needs you. All runs are fine.");
  expect(bubble()).not.toHaveTextContent("List what needs attention");
  expect(bubble()).not.toHaveTextContent("Thinking");
  expect(said()).toEqual(["Nothing needs you."]);
  expect(bubble()).toHaveTextContent("Speaking");
  act(() => synth.finishCurrent());
  expect(said()).toEqual(["Nothing needs you.", "All runs are fine."]);
  // A reply that asks nothing does not listen again.
  act(() => synth.finishCurrent());
  await act(async () => {});
  expect(FakeSpeechRecognition.instances).toHaveLength(1);
});

test("after a reply that ends in a question the bubble listens once more, and the answer goes to the assistant", async () => {
  render(<App />);
  await ask("send it");
  await waitFor(() => expect(transport.turns).toHaveLength(1));
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  act(() => transport.emit({ type: "done", text: "Send it how: request changes, approve, or approve after fixes?" }));
  expect(said()).toEqual(["Send it how: request changes, approve, or approve after fixes?"]);
  expect(FakeSpeechRecognition.instances).toHaveLength(1);
  act(() => synth.finishCurrent());
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(2));
  act(() => recognizer().emitStart());
  expect(bubble()).toHaveTextContent("Listening for your answer");
  // The question stays on screen while the bubble listens.
  expect(bubble()).toHaveTextContent("Send it how: request changes, approve, or approve after fixes?");
  act(() => recognizer().emitResult("request changes", true));
  act(() => recognizer().emitEnd());
  await waitFor(() => expect(transport.turns).toHaveLength(2));
  expect(transport.turns[1]).toEqual({ conversationId: "c1", text: "request changes", source: "voice" });
  expect(bubble()).toHaveTextContent("request changes");
  // It listens once: the answer's reply, with no question, ends there.
  act(() => transport.emit({ type: "turn", turnId: "t2" }));
  act(() => transport.emit({ type: "done", text: "Sent back." }));
  act(() => synth.finishCurrent());
  await act(async () => {});
  expect(FakeSpeechRecognition.instances).toHaveLength(2);
});

test("stopping a spoken question with Escape does not listen again", async () => {
  render(<App />);
  await ask("send it");
  await waitFor(() => expect(transport.turns).toHaveLength(1));
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  act(() => transport.emit({ type: "done", text: "Which run?" }));
  fireEvent.keyDown(document.body, { key: "Escape" });
  await act(async () => {});
  expect(FakeSpeechRecognition.instances).toHaveLength(1);
  expect(bubble()).toHaveTextContent("Which run?");
});

async function askForApproval() {
  render(<App />);
  await ask("cancel the prisma run");
  await waitFor(() => expect(transport.turns).toHaveLength(1));
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  act(() => transport.emit({ type: "confirm", requestId: "r1", toolUseId: "u1", name: "cancel_run", title: "Cancel a run", summary: "Cancel run 7f3a1b2c", args: { run_id: "7f3a1b2c" }, expiresAt }));
  // In the bubble the card asks a question, with Confirm and Cancel and no note field.
  const card = within(bubble()).getByRole("group", { name: "Cancel run 7f3a1b2c?" });
  expect(card).toHaveTextContent("Cancel a run: cancel run 7f3a1b2c");
  expect(within(card).getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  expect(within(card).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  expect(within(card).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  expect(within(card).queryByRole("button", { name: "Deny" })).not.toBeInTheDocument();
  expect(within(card).queryByRole("textbox")).not.toBeInTheDocument();
  expect(within(card).getByText(/left$/)).toBeInTheDocument();
  expect(said()).toEqual(["Cancel run 7f3a1b2c?"]);
  act(() => synth.finishCurrent());
  act(() => synth.finishCurrent());
  expect(said()).toEqual(["Cancel run 7f3a1b2c?", "Say yes or no."]);
  // When the question is read out, the bubble listens once for the answer.
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(2));
  act(() => recognizer().emitStart());
}

test("an approval is read out and yes approves it", async () => {
  await askForApproval();
  act(() => recognizer().emitResult("Yes.", true));
  act(() => recognizer().emitEnd());
  await waitFor(() => expect(transport.replies).toEqual([{ turnId: "t1", requestId: "r1", approved: true }]));
  expect(transport.turns).toHaveLength(1);
  act(() => transport.emit({ type: "confirmed", requestId: "r1", approved: true }));
  const card = within(bubble()).getByRole("group", { name: "Cancel run 7f3a1b2c?" });
  expect(card).toHaveTextContent("Confirmed");
  expect(bubble()).toHaveTextContent('Confirmed by voice: "Yes."');
});

test("Cancel on the card cancels without a note", async () => {
  await askForApproval();
  fireEvent.click(within(bubble()).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(transport.replies).toEqual([{ turnId: "t1", requestId: "r1", approved: false }]));
  act(() => transport.emit({ type: "confirmed", requestId: "r1", approved: false }));
  expect(within(bubble()).getByRole("group", { name: "Cancel run 7f3a1b2c?" })).toHaveTextContent("Cancelled");
});

test("no with words after it denies with them as the note", async () => {
  await askForApproval();
  act(() => recognizer().emitResult("no, let it finish", true));
  act(() => recognizer().emitEnd());
  await waitFor(() => expect(transport.replies).toEqual([{ turnId: "t1", requestId: "r1", approved: false, note: "let it finish" }]));
});

test("anything else keeps the card open", async () => {
  await askForApproval();
  act(() => recognizer().emitResult("maybe later", true));
  act(() => recognizer().emitEnd());
  await act(async () => {});
  expect(transport.replies).toEqual([]);
  expect(transport.turns).toHaveLength(1);
  expect(said().at(-1)).toBe("Say yes or no, or use the buttons.");
  // The buttons still work.
  fireEvent.click(within(bubble()).getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(transport.replies).toEqual([{ turnId: "t1", requestId: "r1", approved: true }]));
});

test("Escape stops speech, then closes the bubble", async () => {
  render(<App />);
  await ask("what needs me");
  await waitFor(() => expect(transport.turns).toHaveLength(1));
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  act(() => transport.emit({ type: "done", text: "Two runs wait. One failed." }));
  expect(said()).toEqual(["Two runs wait."]);
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(synth.cancels).toBeGreaterThan(0);
  expect(bubble()).toBeInTheDocument();
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(screen.queryByRole("region", { name: "Voice assistant" })).not.toBeInTheDocument();
});

test("with the assistant off the bubble says so and sends nothing", async () => {
  render(<App available={false} />);
  await ask("what needs me");
  expect(bubble()).toHaveTextContent("The assistant is off.");
  expect(transport.turns).toEqual([]);
});

test("Open in panel opens the conversation and closes the bubble", async () => {
  render(<App />);
  await ask("what needs me");
  await waitFor(() => expect(transport.turns).toHaveLength(1));
  fireEvent.click(within(bubble()).getByRole("button", { name: "Open in panel" }));
  expect(screen.queryByRole("region", { name: "Voice assistant" })).not.toBeInTheDocument();
});

test("Ctrl+M while the reply is spoken stops it and listens", async () => {
  render(<App />);
  await ask("what needs me");
  await waitFor(() => expect(transport.turns).toHaveLength(1));
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  act(() => transport.emit({ type: "done", text: "Two runs wait. One failed." }));
  expect(said()).toEqual(["Two runs wait."]);
  pressCtrlM();
  expect(synth.cancels).toBeGreaterThan(0);
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(2));
  act(() => recognizer().emitStart());
  expect(bubble()).toHaveTextContent("Listening");
  // What was left of the reply is not spoken after the interruption.
  act(() => synth.finishCurrent());
  expect(said()).toEqual(["Two runs wait."]);
});

test("a long spoken reply stops after three sentences and says the rest is on screen", async () => {
  render(<App />);
  await ask("what failed today");
  await waitFor(() => expect(transport.turns).toHaveLength(1));
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  act(() => transport.emit({ type: "done", text: "One. Two. Three. Four. Five." }));
  for (let i = 0; i < 6; i++) act(() => synth.finishCurrent());
  expect(said()).toEqual(["One.", "Two.", "Three.", "The rest is on screen."]);
  expect(bubble()).toHaveTextContent("One. Two. Three. Four. Five.");
});

/** The panel's tool runner for MCP Apps views, as a view's frame reaches it. */
const viewTools: { call?: ReturnType<typeof useAssistantPanel>["callViewTool"] } = {};
function GrabViewTools() {
  const { callViewTool } = useAssistantPanel();
  useEffect(() => {
    viewTools.call = callViewTool;
  }, [callViewTool]);
  return null;
}

const RUN = "7f3a1b2c-0000-4000-8000-000000000000";

test("a view's call that needs approval shows in the open bubble as a confirmation card, and a spoken yes confirms it", async () => {
  transport.toolResults.set("cancel_run", { id: RUN, status: "cancelled" });
  render(
    <App>
      <GrabViewTools />
    </App>,
  );
  await ask("what needs me");
  await waitFor(() => expect(transport.turns).toHaveLength(1));
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  act(() => transport.emit({ type: "done", text: "Run 7f3a waits." }));
  act(() => synth.finishCurrent());
  let result: unknown;
  act(() => void viewTools.call!("u1", { name: "cancel_run", arguments: { run_id: RUN } }).then((r) => (result = r)));
  const card = await within(bubble()).findByRole("group", { name: "Cancel run 7f3a1b2c?" });
  expect(within(card).getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  expect(within(card).queryByRole("textbox")).not.toBeInTheDocument();
  await waitFor(() => expect(said().at(-1)).toBe("Cancel run 7f3a1b2c?"));
  act(() => synth.finishCurrent());
  act(() => synth.finishCurrent());
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(2));
  expect(transport.toolCalls).toEqual([]);
  act(() => recognizer().emitStart());
  expect(bubble()).toHaveTextContent("Say yes or no");
  act(() => recognizer().emitResult("yes", true));
  act(() => recognizer().emitEnd());
  await waitFor(() => expect(result).toEqual({ content: [{ type: "text", text: JSON.stringify({ id: RUN, status: "cancelled" }, null, 2) }] }));
  expect(transport.toolCalls).toEqual([{ name: "cancel_run", args: { run_id: RUN } }]);
  // The answer was not sent to the assistant as a question.
  expect(transport.turns).toHaveLength(1);
});

test("a spoken no with words after it cancels a view's call with them as the note", async () => {
  render(
    <App>
      <GrabViewTools />
    </App>,
  );
  await ask("what needs me");
  await waitFor(() => expect(transport.turns).toHaveLength(1));
  let result: unknown;
  act(() => void viewTools.call!("u1", { name: "cancel_run", arguments: { run_id: RUN } }).then((r) => (result = r)));
  await within(bubble()).findByRole("group", { name: "Cancel run 7f3a1b2c?" });
  act(() => synth.finishCurrent());
  act(() => synth.finishCurrent());
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(2));
  act(() => recognizer().emitStart());
  act(() => recognizer().emitResult("no, let it finish", true));
  act(() => recognizer().emitEnd());
  await waitFor(() => expect(result).toEqual({ content: [{ type: "text", text: "The person did not approve this: let it finish." }], isError: true }));
  expect(transport.toolCalls).toEqual([]);
});

/** A window as wide as a phone (`phone`) or a laptop: only the phone query matches on a phone. */
function windowIsPhone(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: phone && query === "(max-width: 767px)",
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

test("on a phone the assist button hides while the bubble is open", async () => {
  windowIsPhone(true);
  try {
    render(<App panel />);
    expect(screen.getByRole("button", { name: "Assistant" })).toBeInTheDocument();
    await ask("what needs me");
    expect(bubble()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Assistant" })).not.toBeInTheDocument();
    fireEvent.click(within(bubble()).getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "Assistant" })).toBeInTheDocument();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("on a wider screen the assist button stays while the bubble is open", async () => {
  windowIsPhone(false);
  try {
    render(<App panel />);
    await ask("what needs me");
    expect(bubble()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assistant" })).toBeInTheDocument();
  } finally {
    vi.unstubAllGlobals();
  }
});
