import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { FakeSpeechRecognition } from "@/lib/voice/testing/fake-speech-recognition";
import { VoiceTestApp } from "./testing/voice-test-app";

const latest = () => FakeSpeechRecognition.instances.at(-1)!;
beforeEach(() => {
  FakeSpeechRecognition.reset();
  localStorage.clear();
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
