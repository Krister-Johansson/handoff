import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AssistantButton } from "@/components/assistant/assistant-button";
import { AssistantProvider } from "@/components/assistant/assistant-provider";
import { AssistantSheet } from "@/components/assistant/assistant-sheet";
import { FakeAssistantTransport } from "@/lib/assistant/testing/fake-assistant-transport";
import { notify } from "@/lib/notify";
import { DEFAULT_VOICE_PREFS, writeVoicePrefs, type VoicePrefs } from "@/lib/voice/prefs";
import { createSpeaker } from "@/lib/voice/speaker";
import { FakeSpeechRecognition } from "@/lib/voice/testing/fake-speech-recognition";
import { FakePlayer } from "@/lib/voice/testing/fake-player";
import { VoiceTestApp } from "./testing/voice-test-app";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/projects" }));
vi.mock("@/lib/ping", () => ({ playPing: vi.fn() }));

beforeEach(() => {
  FakeSpeechRecognition.reset();
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});

const voicePrefs = (patch: Partial<VoicePrefs>) => writeVoicePrefs({ ...DEFAULT_VOICE_PREFS, ...patch });

test("starting to listen stops the speech first", async () => {
  const speaker = createSpeaker(new FakePlayer(), () => DEFAULT_VOICE_PREFS);
  speaker.speak("A run failed.", { priority: "notification" });
  render(<VoiceTestApp speaker={speaker} />);
  expect(speaker.isSpeaking()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Listen" }));
  expect(speaker.isSpeaking()).toBe(false);
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(1));
});

test("listening that starts in a text field dictates and keeps going until stopped", async () => {
  render(<VoiceTestApp />);
  const note = screen.getByLabelText("Note");
  note.focus();
  // The header button keeps focus where it was, so a click from a text field dictates into it.
  const button = screen.getByRole("button", { name: "Listen" });
  expect(fireEvent.mouseDown(button)).toBe(false);
  fireEvent.click(button);
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(1));
  expect(FakeSpeechRecognition.instances[0]).toMatchObject({ continuous: true });
  expect(note).toHaveFocus();
});

test("the strip folds away ten seconds after the last thing it showed", async () => {
  vi.useFakeTimers();
  try {
    render(<VoiceTestApp />);
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    await act(async () => {});
    const recognizer = FakeSpeechRecognition.instances[0]!;
    act(() => recognizer.emitStart());
    act(() => recognizer.emitError("no-speech"));
    act(() => recognizer.emitEnd());
    expect(screen.getByRole("status", { name: "Voice" })).toHaveTextContent("Heard nothing.");
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("status", { name: "Voice" })).toBeEmptyDOMElement();
  } finally {
    vi.useRealTimers();
  }
});

/** The assistant panel and voice, as the layout mounts them, speaking through a fake player. */
function PanelApp({ transport, player }: { transport: FakeAssistantTransport; player: FakePlayer }) {
  const speaker = createSpeaker(player, () => DEFAULT_VOICE_PREFS);
  return (
    <AssistantProvider transport={transport} available>
      <VoiceTestApp speaker={speaker}>
        <AssistantButton />
        <AssistantSheet />
      </VoiceTestApp>
    </AssistantProvider>
  );
}

/** Opens the panel and sends a typed message; the turn waits for the test's events. */
async function askInPanel(text: string) {
  const transport = new FakeAssistantTransport();
  const player = new FakePlayer();
  render(<PanelApp transport={transport} player={player} />);
  fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
  fireEvent.change(await screen.findByLabelText("Message the assistant"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(transport.turns).toHaveLength(1));
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  return { transport, player };
}

test("a completed assistant reply is spoken when speakReplies is on and not when off", async () => {
  voicePrefs({ speakReplies: true });
  const on = await askInPanel("What needs me?");
  act(() => on.transport.emit({ type: "done", text: "Two runs wait for you." }));
  expect(on.player.spoken).toEqual(["Two runs wait for you."]);
  cleanup();

  voicePrefs({ speakReplies: false });
  const off = await askInPanel("What needs me?");
  act(() => off.transport.emit({ type: "done", text: "Two runs wait for you." }));
  expect(off.player.spoken).toEqual([]);
});

test("a streaming reply is not spoken until done", async () => {
  voicePrefs({ speakReplies: true });
  const { transport, player } = await askInPanel("What failed?");
  act(() => transport.emit({ type: "text", text: "The tester " }));
  act(() => transport.emit({ type: "text", text: "failed. It could not reach the database." }));
  expect(player.spoken).toEqual([]);
  act(() => transport.emit({ type: "done", text: "The tester failed. It could not reach the database." }));
  expect(player.spoken).toEqual(["The tester failed."]);
  act(() => player.finishCurrent());
  expect(player.spoken).toEqual(["The tester failed.", "It could not reach the database."]);
});

test("the reply text stays on screen", async () => {
  voicePrefs({ speakReplies: true });
  const { transport, player } = await askInPanel("What failed?");
  act(() => transport.emit({ type: "done", text: "The tester failed. It could not reach the database." }));
  for (let i = 0; i < 3; i++) act(() => player.finishCurrent());
  expect(player.spoken).toEqual(["The tester failed.", "It could not reach the database."]);
  expect(within(screen.getByRole("dialog", { name: "Assistant" })).getByText("The tester failed. It could not reach the database.")).toBeInTheDocument();
});

test("the voice provider speaks new notifications with the speaker", () => {
  voicePrefs({ speakNotifications: true });
  const player = new FakePlayer();
  render(<VoiceTestApp speaker={createSpeaker(player, () => DEFAULT_VOICE_PREFS)} />);
  act(() => notify([{ id: "e2", tone: "danger", title: "sandbox: run failed at coder", body: "", href: "/projects/p1/runs/e2" }]));
  expect(player.spoken).toEqual(["sandbox: run failed at coder."]);
  expect(screen.getByRole("status", { name: "Voice" })).toHaveTextContent("Speaking");
});

test("a notification that arrives while listening is spoken when listening ends", async () => {
  voicePrefs({ speakNotifications: true });
  const player = new FakePlayer();
  render(<VoiceTestApp speaker={createSpeaker(player, () => DEFAULT_VOICE_PREFS)} />);
  screen.getByLabelText("Note").focus();
  fireEvent.click(screen.getByRole("button", { name: "Listen" }));
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(1));
  const recognizer = FakeSpeechRecognition.instances[0]!;
  act(() => recognizer.emitStart());
  act(() => notify([{ id: "q1", tone: "attention", title: "sandbox: gate asks a question", body: "", href: "/inbox" }]));
  // The person keeps dictating; the dashboard does not talk over them.
  expect(player.spoken).toEqual([]);
  expect(recognizer.aborted).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Stop listening" }));
  act(() => recognizer.emitEnd());
  expect(player.spoken).toEqual(["sandbox: gate asks a question."]);
});
