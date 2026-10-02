import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { NotificationKind } from "@/lib/notifications";
import { DEFAULT_VOICE_PREFS, writeVoicePrefs, type VoicePrefs } from "@/lib/voice/prefs";
import { createSpeaker } from "@/lib/voice/speaker";
import { FakePlayer } from "@/lib/voice/testing/fake-player";
import { notify, setNotificationVoice } from "./notify";

vi.mock("@/lib/ping", () => ({ playPing: vi.fn() }));

let player: FakePlayer;
let unregister: () => void;

beforeEach(() => {
  localStorage.clear();
  player = new FakePlayer();
  const speaker = createSpeaker(player, () => DEFAULT_VOICE_PREFS);
  unregister = setNotificationVoice((text) => speaker.speak(text, { priority: "notification" }));
});
afterEach(() => unregister());

const voice = (patch: Partial<VoicePrefs>) => writeVoicePrefs({ ...DEFAULT_VOICE_PREFS, ...patch });
const item = (kind: NotificationKind, title: string, body = "Add a CHANGELOG.md") => ({ id: `${kind}-${title}`, kind, title, body, href: `/projects/p1/runs/${kind}` });

/** Everything the speaker says, sentence by sentence, letting each sentence end. */
function spoken() {
  for (let i = 0; i < 50; i++) player.finishCurrent();
  return player.spoken;
}

test("notify speaks input, permission, ready and failed items when speakNotifications is on", () => {
  voice({ speakNotifications: true });
  notify([
    item("input", "sandbox: gate asks a question"),
    item("permission", "sandbox: coder asks to run pnpm"),
    item("ready", "sandbox: PR #54 is ready to merge", ""),
    item("failed", "sandbox: run failed at coder", "The tests did not pass."),
  ]);
  expect(spoken()).toEqual([
    "sandbox: gate asks a question.",
    "Add a CHANGELOG.md.",
    "sandbox: coder asks to run pnpm.",
    "Add a CHANGELOG.md.",
    "sandbox: PR #54 is ready to merge.",
    "sandbox: run failed at coder.",
    "The tests did not pass.",
  ]);
});

test("finished and merged are spoken only with speakFinished", () => {
  voice({ speakNotifications: true });
  notify([item("finished", "sandbox: run finished", ""), item("merged", "sandbox: PR #54 merged", "")]);
  expect(spoken()).toEqual([]);
  voice({ speakNotifications: true, speakFinished: true });
  notify([item("finished", "todo: run finished", ""), item("merged", "todo: PR #9 merged", "")]);
  expect(spoken()).toEqual(["todo: run finished.", "todo: PR #9 merged."]);
});

test("started is never spoken", () => {
  voice({ speakNotifications: true, speakFinished: true });
  notify([item("started", "sandbox: run started", "")]);
  expect(spoken()).toEqual([]);
});

test("nothing is spoken when the preference is off", () => {
  voice({ speakNotifications: false, speakFinished: true });
  notify([item("failed", "sandbox: run failed at coder"), item("input", "sandbox: gate asks a question")]);
  expect(spoken()).toEqual([]);
});

test("a notification another tab of the dashboard already spoke is not spoken again", () => {
  voice({ speakNotifications: true });
  const failed = item("failed", "sandbox: run failed at coder", "");
  notify([failed]);
  expect(spoken()).toEqual(["sandbox: run failed at coder."]);
  // Another tab polls the same feed and gets the same item.
  notify([failed]);
  expect(spoken()).toEqual(["sandbox: run failed at coder."]);
});
