import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AssistantButton } from "@/components/assistant/assistant-button";
import { AssistantProvider } from "@/components/assistant/assistant-provider";
import { AssistantSheet } from "@/components/assistant/assistant-sheet";
import { FakeAssistantTransport } from "@/lib/assistant/testing/fake-assistant-transport";
import { FakeSpeechRecognition } from "@/lib/voice/testing/fake-speech-recognition";
import { VoiceTestApp } from "./testing/voice-test-app";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/projects" }));

const latest = () => FakeSpeechRecognition.instances.at(-1)!;
beforeEach(() => {
  FakeSpeechRecognition.reset();
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});

test("V toggles listening outside text fields and does nothing inside a textarea", async () => {
  render(<VoiceTestApp />);
  fireEvent.keyDown(screen.getByLabelText("Note"), { key: "v" });
  await act(async () => {});
  expect(FakeSpeechRecognition.instances).toEqual([]);

  fireEvent.keyDown(document.body, { key: "v" });
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(1));
  expect(latest()).toMatchObject({ continuous: false });
  act(() => latest().emitStart());
  fireEvent.keyDown(document.body, { key: "v" });
  expect(latest().stopped).toBe(true);
  // With a modifier V is someone else's shortcut.
  act(() => latest().emitEnd());
  fireEvent.keyDown(document.body, { key: "v", metaKey: true });
  await act(async () => {});
  expect(FakeSpeechRecognition.instances).toHaveLength(1);
});

/** Presses Ctrl+M on `target`; returns false when the page took the key (preventDefault). */
const ctrlM = (target: Element = document.body, init: KeyboardEventInit = {}) => fireEvent.keyDown(target, { key: "m", code: "KeyM", ctrlKey: true, ...init });

test("Ctrl+M opens the bubble", async () => {
  render(<VoiceTestApp />);
  expect(screen.queryByRole("region", { name: "Voice assistant" })).not.toBeInTheDocument();
  expect(ctrlM()).toBe(false);
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(1));
  // One question, asked in the bubble.
  expect(latest()).toMatchObject({ continuous: false });
  act(() => latest().emitStart());
  expect(screen.getByRole("region", { name: "Voice assistant" })).toHaveTextContent("Listening");
  // A second Ctrl+M stops listening.
  ctrlM();
  expect(latest().stopped).toBe(true);
});

test("Ctrl+M with the panel open dictates into the composer", async () => {
  render(
    <AssistantProvider transport={new FakeAssistantTransport()} available>
      <VoiceTestApp>
        <AssistantButton />
        <AssistantSheet />
      </VoiceTestApp>
    </AssistantProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
  const composer = await screen.findByLabelText<HTMLTextAreaElement>("Message the assistant");
  // Focus is on the page, not in the composer.
  await waitFor(() => expect(composer).toHaveFocus());
  composer.blur();
  expect(ctrlM()).toBe(false);
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(1));
  expect(composer).toHaveFocus();
  // Dictation keeps listening until stopped, and no bubble opens.
  expect(latest()).toMatchObject({ continuous: true });
  act(() => latest().emitStart());
  expect(screen.queryByRole("region", { name: "Voice assistant" })).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Assistant" })).toHaveTextContent("Dictating");
  act(() => latest().emitResult("how is run 7f3a", true));
  expect(composer.value).toBe("how is run 7f3a");
});

test("Ctrl+M works while typing", async () => {
  render(<VoiceTestApp />);
  const note = screen.getByLabelText<HTMLTextAreaElement>("Note");
  note.value = "Half a thought";
  note.focus();
  expect(ctrlM(note)).toBe(false);
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(1));
  // With the panel closed it asks in the bubble, also from a text field, and leaves the field as it was.
  expect(latest()).toMatchObject({ continuous: false });
  act(() => latest().emitStart());
  expect(screen.getByRole("region", { name: "Voice assistant" })).toHaveTextContent("Listening");
  expect(note.value).toBe("Half a thought");
  ctrlM(note);
  expect(latest().stopped).toBe(true);
});

test("Escape stops listening and leaves an idle page alone", async () => {
  render(<VoiceTestApp />);
  const idle = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  document.body.dispatchEvent(idle);
  expect(idle.defaultPrevented).toBe(false);

  fireEvent.keyDown(document.body, { key: "v" });
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(1));
  act(() => latest().emitStart());
  act(() => latest().emitResult("cancel the", false));
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(latest().aborted).toBe(true);
  expect(screen.getByRole("button", { name: "Listen" })).toHaveAttribute("aria-pressed", "false");
});
