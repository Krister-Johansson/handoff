import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { elevenLabsPlayer } from "./elevenlabs-player";
import { DEFAULT_VOICE_PREFS } from "./prefs";

const prefs = { ...DEFAULT_VOICE_PREFS, elevenLabsVoiceId: "v1", rate: 1.25 };

class FakeAudio {
  static made: FakeAudio[] = [];
  playbackRate = 1;
  paused = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly src: string) {
    FakeAudio.made.push(this);
  }
  play() {
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

beforeEach(() => {
  FakeAudio.made = [];
  let n = 0;
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => `blob:${++n}`, revokeObjectURL: vi.fn() }));
});
afterEach(() => vi.unstubAllGlobals());

test("plays the dashboard's audio for a sentence at the chosen rate, fetching a prefetched sentence only once", async () => {
  const fetch = vi.fn(async () => new Response(new Blob([new Uint8Array([1])], { type: "audio/mpeg" })));
  const player = elevenLabsPlayer(fetch as never, (src) => new FakeAudio(src) as unknown as HTMLAudioElement);
  player.prefetch!("Two runs wait.", prefs);
  const end = vi.fn();
  player.play("Two runs wait.", prefs, { end, error: vi.fn() });
  await vi.waitFor(() => expect(FakeAudio.made).toHaveLength(1));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith("/api/voice/speak", expect.objectContaining({ method: "POST", body: JSON.stringify({ text: "Two runs wait.", voiceId: "v1" }) }));
  expect(FakeAudio.made[0]!.playbackRate).toBe(1.25);
  FakeAudio.made[0]!.onended!();
  expect(end).toHaveBeenCalledTimes(1);
});

test("a failed request reports the dashboard's message, and cancel stops the audio", async () => {
  const fetch = vi.fn(async () => Response.json({ error: "ElevenLabs answered 401." }, { status: 502 }));
  const player = elevenLabsPlayer(fetch as never, (src) => new FakeAudio(src) as unknown as HTMLAudioElement);
  const error = vi.fn();
  player.play("Hi.", prefs, { end: vi.fn(), error });
  await vi.waitFor(() => expect(error).toHaveBeenCalledWith("ElevenLabs answered 401."));

  const ok = elevenLabsPlayer((async () => new Response(new Blob([new Uint8Array([1])]))) as never, (src) => new FakeAudio(src) as unknown as HTMLAudioElement);
  const cancel = ok.play("Hi.", prefs, { end: vi.fn(), error: vi.fn() });
  await vi.waitFor(() => expect(FakeAudio.made).toHaveLength(1));
  cancel();
  expect(FakeAudio.made[0]!.paused).toBe(true);
});

test("without a chosen voice it leaves the voice to the dashboard", async () => {
  const fetch = vi.fn(async () => new Response(new Blob([new Uint8Array([1])])));
  elevenLabsPlayer(fetch as never, (src) => new FakeAudio(src) as unknown as HTMLAudioElement).play("Hi.", { ...prefs, elevenLabsVoiceId: null }, { end: vi.fn(), error: vi.fn() });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/voice/speak", expect.objectContaining({ body: JSON.stringify({ text: "Hi." }) })));
});
