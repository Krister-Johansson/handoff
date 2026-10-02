import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AssistantButton } from "@/components/assistant/assistant-button";
import { AssistantProvider } from "@/components/assistant/assistant-provider";
import { AssistantSheet } from "@/components/assistant/assistant-sheet";
import { FakeAssistantTransport } from "@/lib/assistant/testing/fake-assistant-transport";
import { FakeSpeechRecognition, FakeSpeechRecognitionPhrase } from "@/lib/voice/testing/fake-speech-recognition";
import { VoiceTestApp } from "./testing/voice-test-app";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/projects" }));

beforeEach(() => {
  FakeSpeechRecognition.reset();
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

const recognizer = () => FakeSpeechRecognition.instances.at(-1)!;

/** Presses the header button with focus where it is, as a click on it keeps focus there. */
async function listen() {
  const before = FakeSpeechRecognition.instances.length;
  fireEvent.click(screen.getByRole("button", { name: "Listen" }));
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(before + 1));
  act(() => recognizer().emitStart());
}

test("dictation inserts final text at the caret of the focused textarea and never inserts interim text", async () => {
  render(<VoiceTestApp />);
  const note = screen.getByLabelText<HTMLTextAreaElement>("Note");
  note.value = "Use the tool";
  note.focus();
  note.setSelectionRange(8, 8);
  await listen();
  act(() => recognizer().emitResult("Read", false));
  expect(note.value).toBe("Use the tool");
  expect(screen.getByRole("status", { name: "Voice" })).toHaveTextContent("Read");
  act(() => recognizer().emitResult("Read", true));
  expect(note.value).toBe("Use the Read tool");
  // The caret follows the dictated words, so the next phrase lands after them.
  act(() => recognizer().emitResult("only", true));
  expect(note.value).toBe("Use the Read only tool");
  expect(note.selectionStart).toBe("Use the Read only ".length);
});

test("dictation at the end of a text input adds the space between words", async () => {
  render(
    <VoiceTestApp>
      <label htmlFor="task">Task</label>
      <input id="task" defaultValue="Add" />
    </VoiceTestApp>,
  );
  const task = screen.getByLabelText<HTMLInputElement>("Task");
  task.focus();
  task.setSelectionRange(3, 3);
  await listen();
  act(() => recognizer().emitResult("a changelog", true));
  expect(task.value).toBe("Add a changelog");
});

test("dictation into the assistant composer keeps its state, so Send sends the dictated words", async () => {
  const transport = new FakeAssistantTransport();
  render(
    <AssistantProvider transport={transport} available>
      <VoiceTestApp>
        <AssistantButton />
        <AssistantSheet />
      </VoiceTestApp>
    </AssistantProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
  const composer = await screen.findByLabelText<HTMLTextAreaElement>("Message the assistant");
  await waitFor(() => expect(composer).toHaveFocus());
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  await listen();
  act(() => recognizer().emitResult("what needs me", true));
  expect(composer.value).toBe("what needs me");
  // Nothing goes to the assistant until the person sends it.
  expect(transport.turns).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(transport.turns).toEqual([{ conversationId: "c1", text: "what needs me", source: "typed" }]));
});

test("listening favours the project names and node keys on the page", async () => {
  vi.stubGlobal("SpeechRecognitionPhrase", FakeSpeechRecognitionPhrase);
  render(
    <VoiceTestApp>
      <h2 data-voice-phrase="todooverkill">todooverkill</h2>
      <span data-voice-phrase="coder">coder</span>
      <span data-voice-phrase="tester">tester</span>
      <span data-voice-phrase="coder">coder</span>
    </VoiceTestApp>,
  );
  await listen();
  expect(recognizer().phrases.map((p) => (p as FakeSpeechRecognitionPhrase).phrase)).toEqual(["todooverkill", "coder", "tester"]);
});
