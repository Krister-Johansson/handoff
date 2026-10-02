import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { FakeSpeechRecognition } from "@/lib/voice/testing/fake-speech-recognition";
import { VoiceTestApp } from "./testing/voice-test-app";

const latest = () => FakeSpeechRecognition.instances.at(-1)!;
beforeEach(() => {
  FakeSpeechRecognition.reset();
  localStorage.clear();
});

test("the button is absent when SpeechRecognition is missing", () => {
  render(<VoiceTestApp support={{ onDeviceCheck: false }} />);
  expect(screen.queryByRole("button", { name: /Listen/ })).not.toBeInTheDocument();
});

test("the button has aria-pressed true and the live region says Listening after a click", async () => {
  render(<VoiceTestApp />);
  const button = screen.getByRole("button", { name: "Listen" });
  expect(button).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(button);
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(1));
  act(() => latest().emitStart());
  expect(screen.getByRole("button", { name: "Stop listening" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("voice-live")).toHaveTextContent("Listening");
  act(() => latest().emitResult("what needs me", false));
  expect(screen.getByRole("status", { name: "Voice" })).toHaveTextContent("what needs me");
  act(() => latest().emitResult("what needs me", true));
  act(() => latest().emitEnd());
  // No command router yet: the final transcript lands in the strip.
  expect(screen.getByRole("status", { name: "Voice" })).toHaveTextContent("Heard: what needs me");
  expect(screen.getByTestId("voice-live")).toHaveTextContent("Stopped");
});

test("the button offers to install the language pack when available() returns downloadable and calls install on click", async () => {
  FakeSpeechRecognition.availability = "downloadable";
  render(<VoiceTestApp />);
  fireEvent.click(screen.getByRole("button", { name: "Listen" }));
  const install = await screen.findByRole("button", { name: "Install American English for offline use" });
  expect(FakeSpeechRecognition.instances).toEqual([]);
  fireEvent.click(install);
  await waitFor(() => expect(FakeSpeechRecognition.installed).toEqual([{ langs: ["en-US"], processLocally: true }]));
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(1));
});

test("without the on-device check the button shows only once server recognition is allowed", () => {
  const support = { recognition: class {} as never, onDeviceCheck: false };
  const { unmount } = render(<VoiceTestApp support={support} />);
  expect(screen.queryByRole("button", { name: "Listen" })).not.toBeInTheDocument();
  unmount();
  localStorage.setItem("handoff.voice", JSON.stringify({ allowServerRecognition: true }));
  render(<VoiceTestApp support={support} />);
  expect(screen.getByRole("button", { name: "Listen" })).toBeInTheDocument();
});

test("a blocked microphone is explained in the strip and the button stays to retry", async () => {
  render(<VoiceTestApp />);
  fireEvent.click(screen.getByRole("button", { name: "Listen" }));
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(1));
  act(() => latest().emitError("not-allowed"));
  act(() => latest().emitEnd());
  expect(screen.getByRole("status", { name: "Voice" })).toHaveTextContent("Chrome blocked the microphone. Allow it in the site settings.");
  expect(screen.getByRole("button", { name: "Listen" })).toBeEnabled();
});
