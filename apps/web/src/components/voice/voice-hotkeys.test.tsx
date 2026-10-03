import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AssistantProvider } from "@/components/assistant/assistant-provider";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
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

test("V no longer starts voice", async () => {
  render(<VoiceTestApp />);
  // V is a letter again, on the page and in a text field.
  expect(fireEvent.keyDown(document.body, { key: "v", code: "KeyV" })).toBe(true);
  expect(fireEvent.keyDown(screen.getByLabelText("Note"), { key: "v", code: "KeyV" })).toBe(true);
  await act(async () => {});
  expect(FakeSpeechRecognition.instances).toEqual([]);
  expect(screen.queryByRole("region", { name: "Voice assistant" })).not.toBeInTheDocument();
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
        <AssistantPanel />
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

test("Cmd+M is left to the system", async () => {
  render(<VoiceTestApp />);
  // Cmd+M minimizes the window on a Mac; the page neither takes it nor listens. Nor with Ctrl held too,
  // nor Ctrl with Shift or Alt, which belong to the browser and the system.
  expect(fireEvent.keyDown(document.body, { key: "m", code: "KeyM", metaKey: true })).toBe(true);
  expect(ctrlM(document.body, { metaKey: true })).toBe(true);
  expect(ctrlM(document.body, { shiftKey: true, key: "M" })).toBe(true);
  expect(ctrlM(document.body, { altKey: true, key: "µ" })).toBe(true);
  await act(async () => {});
  expect(FakeSpeechRecognition.instances).toEqual([]);
});

test("Escape stops listening and leaves an idle page alone", async () => {
  render(<VoiceTestApp />);
  const idle = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  document.body.dispatchEvent(idle);
  expect(idle.defaultPrevented).toBe(false);

  ctrlM();
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(1));
  act(() => latest().emitStart());
  act(() => latest().emitResult("cancel the", false));
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(latest().aborted).toBe(true);
  expect(screen.getByRole("button", { name: "Listen" })).toHaveAttribute("aria-pressed", "false");
});
