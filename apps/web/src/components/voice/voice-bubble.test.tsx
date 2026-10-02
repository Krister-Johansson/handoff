import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AssistantProvider } from "@/components/assistant/assistant-provider";
import { FakeAssistantTransport } from "@/lib/assistant/testing/fake-assistant-transport";
import { DEFAULT_VOICE_PREFS } from "@/lib/voice/prefs";
import { createSpeaker } from "@/lib/voice/speaker";
import type { RecognitionCtor } from "@/lib/voice/support";
import { FakeSpeechRecognition } from "@/lib/voice/testing/fake-speech-recognition";
import { FakeSpeechSynthesis, FakeUtterance } from "@/lib/voice/testing/fake-speech-synthesis";
import { VoiceBubble } from "./voice-bubble";
import { VoiceHotkeys } from "./voice-hotkeys";
import { VoiceProvider } from "./voice-provider";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/projects" }));

let transport: FakeAssistantTransport;
let synth: FakeSpeechSynthesis;

beforeEach(() => {
  FakeSpeechRecognition.reset();
  localStorage.clear();
  transport = new FakeAssistantTransport();
  synth = new FakeSpeechSynthesis();
  Element.prototype.scrollIntoView = vi.fn();
});

function App({ available = true }: { available?: boolean }) {
  const speaker = createSpeaker(synth as unknown as SpeechSynthesis, () => DEFAULT_VOICE_PREFS, (t) => new FakeUtterance(t) as unknown as SpeechSynthesisUtterance);
  return (
    <AssistantProvider transport={transport} available={available}>
      <VoiceProvider support={{ recognition: FakeSpeechRecognition as unknown as RecognitionCtor, onDeviceCheck: true }} speaker={speaker}>
        <VoiceHotkeys />
        <VoiceBubble />
        <main>
          <h1>Projects</h1>
        </main>
      </VoiceProvider>
    </AssistantProvider>
  );
}

const recognizer = () => FakeSpeechRecognition.instances.at(-1)!;
const bubble = () => screen.getByRole("region", { name: "Voice assistant" });
const said = () => synth.spoken.map((u) => u.text);

/** Presses V and says `text` as one utterance. */
async function ask(text: string) {
  const before = FakeSpeechRecognition.instances.length;
  fireEvent.keyDown(document.body, { key: "v" });
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(before + 1));
  act(() => recognizer().emitStart());
  act(() => recognizer().emitResult(text, true));
  act(() => recognizer().emitEnd());
}

test("V opens the bubble and the final transcript goes to the assistant with source voice", async () => {
  render(<App />);
  expect(screen.queryByRole("region", { name: "Voice assistant" })).not.toBeInTheDocument();
  fireEvent.keyDown(document.body, { key: "v" });
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
  fireEvent.keyDown(document.body, { key: "v" });
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(1));
  act(() => recognizer().emitStart());
  act(() => recognizer().emitResult("cancel every", false));
  fireEvent.keyDown(document.body, { key: "Escape" });
  await act(async () => {});
  expect(transport.turns).toEqual([]);
});

test("the bubble shows the tool status, then the reply, and speaks it", async () => {
  render(<App />);
  await ask("what needs me");
  await waitFor(() => expect(transport.turns).toHaveLength(1));
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  act(() => transport.emit({ type: "tool_call", id: "u1", name: "list_attention", title: "List what needs attention", summary: "List what needs attention", args: {} }));
  expect(bubble()).toHaveTextContent("Calling List what needs attention");
  act(() => transport.emit({ type: "tool_result", id: "u1", result: "[]", isError: false }));
  act(() => transport.emit({ type: "text", text: "Nothing needs you. " }));
  act(() => transport.emit({ type: "done", text: "Nothing needs you. All runs are fine." }));
  expect(bubble()).toHaveTextContent("Nothing needs you. All runs are fine.");
  expect(said()).toEqual(["Nothing needs you."]);
  expect(bubble()).toHaveTextContent("Speaking");
  act(() => synth.finishCurrent());
  expect(said()).toEqual(["Nothing needs you.", "All runs are fine."]);
});

async function askForApproval() {
  render(<App />);
  await ask("cancel the prisma run");
  await waitFor(() => expect(transport.turns).toHaveLength(1));
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  act(() => transport.emit({ type: "confirm", requestId: "r1", toolUseId: "u1", name: "cancel_run", title: "Cancel a run", summary: "Cancel run 7f3a1b2c", args: { run_id: "7f3a1b2c" } }));
  expect(within(bubble()).getByRole("group", { name: "Approve: Cancel a run" })).toBeInTheDocument();
  expect(said()).toEqual(["Cancel a run: Cancel run 7f3a1b2c."]);
  act(() => synth.finishCurrent());
  act(() => synth.finishCurrent());
  expect(said()).toEqual(["Cancel a run: Cancel run 7f3a1b2c.", "Say yes or no."]);
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
  fireEvent.click(within(bubble()).getByRole("button", { name: "Approve" }));
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
