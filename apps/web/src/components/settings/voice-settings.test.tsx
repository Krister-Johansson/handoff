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
  expect(screen.getByRole("note")).toHaveTextContent("This browser has no speech recognition, so the microphone button is hidden. Replies and notifications can still be read aloud.");
  expect(screen.getByRole("switch", { name: "Server-based recognition" })).toBeDisabled();
  expect(screen.getByLabelText("Language")).toBeDisabled();
  expect(screen.getByText("Listening")).toBeInTheDocument();
  expect(screen.getByText("Speaking")).toBeInTheDocument();
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

test("the voice list groups voices on this device before online ones, which show only when allowed, and Test voice speaks with the choice", () => {
  const synth = fakeSynth([voice("Google US English", "en-US", false), voice("Samantha", "en-US", true), voice("Alva", "sv-SE", true)]);
  render(<VoiceSettings support={{ synth, onDeviceCheck: false }} />);
  const select = screen.getByLabelText("Voice");
  const groups = () => within(select).getAllByRole("group").map((g) => [g.getAttribute("label"), within(g).getAllByRole("option").map((o) => o.textContent)]);
  expect(within(select).getAllByRole("option")[0]).toHaveTextContent("Automatic");
  expect(groups()).toEqual([["On this device", ["Samantha (en-US)", "Alva (sv-SE)"]]]);

  fireEvent.click(screen.getByRole("switch", { name: "Online voices" }));
  expect(groups()).toEqual([
    ["On this device", ["Samantha (en-US)", "Alva (sv-SE)"]],
    ["Online", ["Google US English (en-US)"]],
  ]);
  expect(within(screen.getByLabelText("Rate")).getByRole("option", { name: "1x, normal" })).toBeInTheDocument();

  fireEvent.change(select, { target: { value: "Samantha" } });
  fireEvent.change(screen.getByLabelText("Rate"), { target: { value: "1.25" } });
  expect(readVoicePrefs()).toMatchObject({ voiceURI: "Samantha", rate: 1.25, allowRemoteVoices: true });

  fireEvent.click(screen.getByRole("button", { name: "Test voice" }));
  const utterance = synth.speak.mock.calls[0]![0] as SpeechSynthesisUtterance;
  expect(utterance).toMatchObject({ text: "This is how handoff sounds.", rate: 1.25, lang: "en-US" });
  expect(utterance.voice?.name).toBe("Samantha");
});

test("Also finished and merged runs is a checkbox available only while notifications are spoken", () => {
  render(<VoiceSettings support={{ synth: fakeSynth([]), onDeviceCheck: false }} />);
  expect(screen.getByRole("checkbox", { name: "Also finished and merged runs" })).toBeDisabled();
  fireEvent.click(screen.getByRole("switch", { name: "Speak notifications" }));
  const also = screen.getByRole("checkbox", { name: "Also finished and merged runs" });
  expect(also).toBeEnabled();
  fireEvent.click(also);
  expect(readVoicePrefs()).toMatchObject({ speakNotifications: true, speakFinished: true });
});

test("voices that load after the first look still show, as Chrome fills the list late", async () => {
  const voices = [voice("Samantha", "en-US", true)];
  let calls = 0;
  const synth = Object.assign(new EventTarget(), { getVoices: () => (calls++ === 0 ? [] : voices), speak: vi.fn(), cancel: vi.fn() }) as unknown as SpeechSynthesis;
  render(<VoiceSettings support={{ synth, onDeviceCheck: false }} />);
  expect(await within(screen.getByLabelText("Voice")).findByRole("option", { name: "Samantha (en-US)" })).toBeInTheDocument();
});
