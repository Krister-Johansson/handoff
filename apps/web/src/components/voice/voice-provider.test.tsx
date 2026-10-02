import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { DEFAULT_VOICE_PREFS } from "@/lib/voice/prefs";
import { createSpeaker } from "@/lib/voice/speaker";
import { FakeSpeechRecognition } from "@/lib/voice/testing/fake-speech-recognition";
import { FakeSpeechSynthesis, FakeUtterance } from "@/lib/voice/testing/fake-speech-synthesis";
import { VoiceTestApp } from "./testing/voice-test-app";

beforeEach(() => {
  FakeSpeechRecognition.reset();
  localStorage.clear();
});

test("starting to listen stops the speech first", async () => {
  const speaker = createSpeaker(new FakeSpeechSynthesis() as unknown as SpeechSynthesis, () => DEFAULT_VOICE_PREFS, (t) => new FakeUtterance(t) as unknown as SpeechSynthesisUtterance);
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
