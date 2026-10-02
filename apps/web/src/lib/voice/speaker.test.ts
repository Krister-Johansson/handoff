import { expect, test } from "vitest";
import { DEFAULT_VOICE_PREFS, type VoicePrefs } from "./prefs";
import { createSpeaker, pickVoice, splitSentences } from "./speaker";
import { FakeSpeechSynthesis, FakeUtterance, fakeVoice } from "./testing/fake-speech-synthesis";

const prefs = (patch: Partial<VoicePrefs> = {}) => ({ ...DEFAULT_VOICE_PREFS, ...patch });
const setup = (patch: Partial<VoicePrefs> = {}, synth = new FakeSpeechSynthesis()) => {
  const speaker = createSpeaker(synth as unknown as SpeechSynthesis, () => prefs(patch), (text) => new FakeUtterance(text) as unknown as SpeechSynthesisUtterance);
  return { synth, speaker, said: () => synth.spoken.map((u) => u.text) };
};

test("splitSentences keeps abbreviations and code fences together and labels code blocks as skipped", () => {
  expect(splitSentences("Run 7f3a failed at e.g. the tester, i.e. after v2.1.0 shipped. It took 1.5 minutes! Retry? coder-1 is next.")).toEqual([
    "Run 7f3a failed at e.g. the tester, i.e. after v2.1.0 shipped.",
    "It took 1.5 minutes!",
    "Retry?",
    "coder-1 is next.",
  ]);
  expect(splitSentences("## Plan\n\nAdd a **slugify** helper in `lib/slug.ts`.\n\n```ts\nexport const a = 1. \n```\n\n- First step\n- Second [step](https://x.test)")).toEqual([
    "Plan",
    "Add a slugify helper in lib/slug.ts.",
    "Code block skipped.",
    "First step",
    "Second step",
  ]);
});

test("pickVoice prefers a local voice in the recognition language and never a remote voice unless allowed", () => {
  const voices = [fakeVoice("Google US English", "en-US", false), fakeVoice("Alva", "sv-SE"), fakeVoice("Samantha", "en-US")];
  expect(pickVoice(voices, prefs())?.name).toBe("Samantha");
  expect(pickVoice([fakeVoice("Google US English", "en-US", false), fakeVoice("Alva", "sv-SE")], prefs())?.name).toBe("Alva");
  expect(pickVoice([fakeVoice("Google US English", "en-US", false)], prefs())).toBeUndefined();
  expect(pickVoice([fakeVoice("Google US English", "en-US", false)], prefs({ allowRemoteVoices: true }))?.name).toBe("Google US English");
});

test("pickVoice honours a stored voiceURI that still exists and falls back when it is gone", () => {
  const voices = [fakeVoice("Samantha", "en-US"), fakeVoice("Albert", "en-US")];
  expect(pickVoice(voices, prefs({ voiceURI: "Albert" }))?.name).toBe("Albert");
  expect(pickVoice(voices, prefs({ voiceURI: "Gone" }))?.name).toBe("Samantha");
  // A stored remote voice is not used once remote voices are switched off.
  expect(pickVoice([...voices, fakeVoice("Google UK English", "en-GB", false)], prefs({ voiceURI: "Google UK English" }))?.name).toBe("Samantha");
});

test("speak queues one utterance per sentence and stop cancels the rest", () => {
  const { synth, speaker, said } = setup({ rate: 1.25 });
  speaker.speak("One. Two. Three.", { priority: "read", title: "Run summary" });
  expect(said()).toEqual(["One."]);
  expect(synth.current).toMatchObject({ lang: "en-US", rate: 1.25, voice: expect.objectContaining({ name: "Samantha" }) });
  expect(speaker.getState()).toMatchObject({ speaking: true, title: "Run summary", sentence: 1, total: 3 });
  synth.finishCurrent();
  expect(said()).toEqual(["One.", "Two."]);
  expect(speaker.getState()).toMatchObject({ sentence: 2, total: 3 });
  speaker.stop();
  expect(synth.cancels).toBeGreaterThan(0);
  synth.finishCurrent();
  expect(said()).toEqual(["One.", "Two."]);
  expect(speaker.getState()).toMatchObject({ speaking: false });
  expect(speaker.isSpeaking()).toBe(false);
});

test("a notification queues behind a reply and ahead of a long read", () => {
  const { synth, speaker, said } = setup();
  speaker.speak("Read one. Read two. Read three.", { priority: "read", title: "Plan" });
  speaker.speak("Reply one. Reply two.", { priority: "reply" });
  speaker.speak("A run failed.", { priority: "notification" });
  // The read was already speaking its first sentence; then the reply, then the notification, then the rest of the read.
  for (let i = 0; i < 5; i++) synth.finishCurrent();
  expect(said()).toEqual(["Read one.", "Reply one.", "Reply two.", "A run failed.", "Read two.", "Read three."]);
  synth.finishCurrent();
  expect(speaker.isSpeaking()).toBe(false);
});

test("nothing is spoken on construction", () => {
  const { synth } = setup();
  expect(synth.spoken).toEqual([]);
  expect(synth.cancels).toBe(0);
});

test("with no usable voice nothing is spoken and the state says why", () => {
  const { synth, speaker } = setup({}, new FakeSpeechSynthesis([fakeVoice("Google US English", "en-US", false)]));
  speaker.speak("Hello.", { priority: "reply" });
  expect(synth.spoken).toEqual([]);
  expect(speaker.getState()).toMatchObject({ speaking: false, error: "No local voice for en-US." });
});
