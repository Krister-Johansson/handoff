import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { DEFAULT_VOICE_PREFS } from "@/lib/voice/prefs";
import { createSpeaker } from "@/lib/voice/speaker";
import { FakeSpeechRecognition } from "@/lib/voice/testing/fake-speech-recognition";
import { FakeSpeechSynthesis, FakeUtterance } from "@/lib/voice/testing/fake-speech-synthesis";
import { ReadAloudButton } from "./read-aloud-button";
import { VoiceTestApp } from "./testing/voice-test-app";

let synth: FakeSpeechSynthesis;
const speakerFor = () => createSpeaker(synth as unknown as SpeechSynthesis, () => DEFAULT_VOICE_PREFS, (t) => new FakeUtterance(t) as unknown as SpeechSynthesisUtterance);
const strip = () => screen.getByRole("status", { name: "Voice" });

beforeEach(() => {
  FakeSpeechRecognition.reset();
  localStorage.clear();
  synth = new FakeSpeechSynthesis();
});

const SUMMARY = "Add a CHANGELOG.md. The run is running. coder-1 failed: tests did not pass.";

test("Read aloud on the run page speaks the registered summary and the strip shows sentence progress", () => {
  render(
    <VoiceTestApp speaker={speakerFor()}>
      <ReadAloudButton title="Run summary" text={SUMMARY} />
    </VoiceTestApp>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Read aloud" }));
  expect(synth.spoken.map((u) => u.text)).toEqual(["Add a CHANGELOG.md."]);
  expect(strip()).toHaveTextContent("Reading: Run summary, sentence 1 of 3");
  act(() => synth.finishCurrent());
  expect(strip()).toHaveTextContent("Reading: Run summary, sentence 2 of 3");
  expect(screen.getByRole("button", { name: "Stop reading" })).toBeInTheDocument();
});

test("Escape stops reading", () => {
  render(
    <VoiceTestApp speaker={speakerFor()}>
      <ReadAloudButton title="Run summary" text={SUMMARY} />
    </VoiceTestApp>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Read aloud" }));
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(synth.cancels).toBeGreaterThan(0);
  act(() => synth.finishCurrent());
  expect(synth.spoken).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Read aloud" })).toBeInTheDocument();
});

test("speaking aborts an active listening session", async () => {
  render(
    <VoiceTestApp speaker={speakerFor()}>
      <ReadAloudButton title="Run summary" text={SUMMARY} />
    </VoiceTestApp>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Listen" }));
  await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(1));
  act(() => FakeSpeechRecognition.instances[0]!.emitStart());
  fireEvent.click(screen.getByRole("button", { name: "Read aloud" }));
  expect(FakeSpeechRecognition.instances[0]!.aborted).toBe(true);
  expect(screen.getByRole("button", { name: "Listen" })).toHaveAttribute("aria-pressed", "false");
});

test("without speech synthesis there is no Read aloud button", () => {
  render(
    <VoiceTestApp>
      <ReadAloudButton title="Run summary" text={SUMMARY} />
    </VoiceTestApp>,
  );
  expect(screen.queryByRole("button", { name: "Read aloud" })).not.toBeInTheDocument();
});
