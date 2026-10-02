import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { readVoicePrefs } from "@/lib/voice/prefs";
import type { VoiceSupport } from "@/lib/voice/support";
import { VoiceSettings } from "./voice-settings";

afterEach(() => localStorage.clear());

// jsdom has no speech synthesis; the component builds its utterance with the browser's constructor.
vi.stubGlobal(
  "SpeechSynthesisUtterance",
  class {
    voice: SpeechSynthesisVoice | null = null;
    rate = 1;
    lang = "";
    constructor(readonly text: string) {}
  },
);

const voice = (name: string, lang: string, localService: boolean) => ({ name, lang, localService, voiceURI: name, default: false }) as SpeechSynthesisVoice;

function fakeSynth(voices: SpeechSynthesisVoice[]) {
  return Object.assign(new EventTarget(), { getVoices: () => voices, speak: vi.fn(), cancel: vi.fn() }) as unknown as SpeechSynthesis & { speak: ReturnType<typeof vi.fn> };
}

class OnDevice {
  static available = async () => "available" as const;
}

test("the Voice tab says recognition is unavailable when no constructor exists and keeps the speaking switches", () => {
  render(<VoiceSettings support={{ synth: fakeSynth([]), onDeviceCheck: false }} />);
  expect(screen.getByText("Speech recognition is not available in this browser. Chrome on Windows, macOS or Linux supports it.")).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "Server-based recognition" })).toBeDisabled();
  expect(screen.getByRole("switch", { name: "Speak replies" })).toBeEnabled();
  expect(screen.getByRole("switch", { name: "Speak notifications" })).toBeEnabled();
});

test("turning on server recognition writes allowServerRecognition true", () => {
  render(<VoiceSettings support={{ recognition: OnDevice as unknown as VoiceSupport["recognition"], onDeviceCheck: true }} />);
  const toggle = screen.getByRole("switch", { name: "Server-based recognition" });
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  expect(readVoicePrefs().allowServerRecognition).toBe(true);
  // Without speech synthesis the speaking settings are off with a note.
  expect(screen.getByText("This browser cannot speak, so the speaking settings are off.")).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "Speak replies" })).toBeDisabled();
});

test("a browser without the on-device check says listening needs server recognition", () => {
  render(<VoiceSettings support={{ recognition: class {} as unknown as VoiceSupport["recognition"], onDeviceCheck: false }} />);
  expect(screen.getByText(/cannot check for on-device recognition/)).toBeInTheDocument();
});

test("the voice list shows local voices for the language first and remote voices only when allowed, and Test voice speaks with the choice", () => {
  const synth = fakeSynth([voice("Google US English", "en-US", false), voice("Samantha", "en-US", true), voice("Alva", "sv-SE", true)]);
  render(<VoiceSettings support={{ synth, onDeviceCheck: false }} />);
  const select = screen.getByLabelText("Voice");
  expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Automatic", "Samantha (en-US)", "Alva (sv-SE)"]);

  fireEvent.click(screen.getByRole("switch", { name: "Remote voices" }));
  expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Automatic", "Samantha (en-US)", "Alva (sv-SE)", "Google US English (en-US, remote)"]);

  fireEvent.change(select, { target: { value: "Samantha" } });
  fireEvent.change(screen.getByLabelText("Rate"), { target: { value: "1.25" } });
  expect(readVoicePrefs()).toMatchObject({ voiceURI: "Samantha", rate: 1.25, allowRemoteVoices: true });

  fireEvent.click(screen.getByRole("button", { name: "Test voice" }));
  const utterance = synth.speak.mock.calls[0]![0] as SpeechSynthesisUtterance;
  expect(utterance).toMatchObject({ text: "This is how handoff sounds.", rate: 1.25, lang: "en-US" });
  expect(utterance.voice?.name).toBe("Samantha");
});

test("Also finished and merged runs is available only while notifications are spoken", () => {
  render(<VoiceSettings support={{ synth: fakeSynth([]), onDeviceCheck: false }} />);
  expect(screen.getByRole("switch", { name: "Also finished and merged runs" })).toBeDisabled();
  fireEvent.click(screen.getByRole("switch", { name: "Speak notifications" }));
  expect(screen.getByRole("switch", { name: "Also finished and merged runs" })).toBeEnabled();
  expect(readVoicePrefs().speakNotifications).toBe(true);
});

test("voices that load after the first look still show, as Chrome fills the list late", async () => {
  const voices = [voice("Samantha", "en-US", true)];
  let calls = 0;
  const synth = Object.assign(new EventTarget(), { getVoices: () => (calls++ === 0 ? [] : voices), speak: vi.fn(), cancel: vi.fn() }) as unknown as SpeechSynthesis;
  render(<VoiceSettings support={{ synth, onDeviceCheck: false }} />);
  expect(await within(screen.getByLabelText("Voice")).findByRole("option", { name: "Samantha (en-US)" })).toBeInTheDocument();
});
