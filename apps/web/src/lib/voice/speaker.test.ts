import { expect, test } from "vitest";
import { DEFAULT_VOICE_PREFS, type VoicePrefs } from "./prefs";
import { createSpeaker, splitSentences, spokenReply } from "./speaker";
import { FakePlayer } from "./testing/fake-player";

const setup = (patch: Partial<VoicePrefs> = {}) => {
  const player = new FakePlayer();
  const speaker = createSpeaker(player, () => ({ ...DEFAULT_VOICE_PREFS, ...patch }));
  return { player, speaker };
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

test("spokenReply keeps three sentences and points to the screen for the rest", () => {
  expect(spokenReply("One. Two.")).toBe("One. Two.");
  expect(spokenReply("One. Two. Three. Four.")).toBe("One. Two. Three. The rest is on screen.");
});

test("speak plays one sentence at a time with the preferences, fetches the next one while it plays, and stop cancels the rest", () => {
  const { player, speaker } = setup({ rate: 1.25, elevenLabsVoiceId: "v1" });
  speaker.speak("One. Two. Three.", { priority: "read", title: "Run summary" });
  expect(player.spoken).toEqual(["One."]);
  expect(player.prefetched).toEqual(["Two."]);
  expect(player.lastPrefs).toMatchObject({ rate: 1.25, elevenLabsVoiceId: "v1" });
  expect(speaker.getState()).toMatchObject({ speaking: true, title: "Run summary", sentence: 1, total: 3 });
  player.finishCurrent();
  expect(player.spoken).toEqual(["One.", "Two."]);
  expect(player.prefetched).toEqual(["Two.", "Three."]);
  expect(speaker.getState()).toMatchObject({ sentence: 2, total: 3 });
  speaker.stop();
  expect(player.cancels).toBe(1);
  player.finishCurrent();
  expect(player.spoken).toEqual(["One.", "Two."]);
  expect(speaker.isSpeaking()).toBe(false);
});

test("a notification queues behind a reply and ahead of a long read", () => {
  const { player, speaker } = setup();
  speaker.speak("Read one. Read two. Read three.", { priority: "read", title: "Plan" });
  speaker.speak("Reply one. Reply two.", { priority: "reply" });
  speaker.speak("A run failed.", { priority: "notification" });
  for (let i = 0; i < 5; i++) player.finishCurrent();
  expect(player.spoken).toEqual(["Read one.", "Reply one.", "Reply two.", "A run failed.", "Read two.", "Read three."]);
  player.finishCurrent();
  expect(speaker.isSpeaking()).toBe(false);
});

test("nothing is spoken on construction", () => {
  const { player } = setup();
  expect(player.spoken).toEqual([]);
});

test("a sentence that cannot be spoken ends the speech with its reason", () => {
  const { player, speaker } = setup();
  speaker.speak("One. Two.", { priority: "reply" });
  player.failCurrent("ElevenLabs answered 401.");
  expect(speaker.getState()).toEqual({ speaking: false, sentence: 0, total: 0, error: "ElevenLabs answered 401." });
  expect(player.spoken).toEqual(["One."]);
  // A new reply speaks again.
  speaker.speak("Three.", { priority: "reply" });
  expect(player.spoken).toEqual(["One.", "Three."]);
});
