import type { VoicePrefs } from "./prefs";
import type { Player } from "./speaker";

/**
 * Speaks a sentence with ElevenLabs through the dashboard's /api/voice/speak, which holds the key, and
 * plays the MP3. A prefetched sentence is fetched once and played from memory.
 */
export function elevenLabsPlayer(
  fetchAudio: typeof fetch = (input, init) => fetch(input, init),
  makeAudio: (src: string) => HTMLAudioElement = (src) => new Audio(src),
): Player {
  const loaded = new Map<string, Promise<Blob>>();
  const keyOf = (sentence: string, prefs: VoicePrefs) => `${prefs.elevenLabsVoiceId}\n${sentence}`;
  const load = (sentence: string, prefs: VoicePrefs) => {
    const key = keyOf(sentence, prefs);
    const known = loaded.get(key);
    if (known) return known;
    const loading = (async () => {
      const response = await fetchAudio("/api/voice/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Without a chosen voice the dashboard picks its default.
        body: JSON.stringify(prefs.elevenLabsVoiceId ? { text: sentence, voiceId: prefs.elevenLabsVoiceId } : { text: sentence }),
      });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? `The dashboard answered ${response.status}.`);
      return response.blob();
    })();
    loaded.set(key, loading);
    loading.catch(() => loaded.delete(key));
    return loading;
  };
  return {
    prefetch(sentence, prefs) {
      load(sentence, prefs).catch(() => {});
    },
    play(sentence, prefs, { end, error }) {
      let cancelled = false;
      let audio: HTMLAudioElement | undefined;
      let url: string | undefined;
      const release = () => {
        if (url) URL.revokeObjectURL(url);
        url = undefined;
      };
      load(sentence, prefs).then(
        (blob) => {
          loaded.delete(keyOf(sentence, prefs));
          if (cancelled) return;
          url = URL.createObjectURL(blob);
          audio = makeAudio(url);
          audio.playbackRate = prefs.rate;
          audio.onended = () => {
            release();
            end();
          };
          audio.onerror = () => {
            release();
            error("The audio could not be played.");
          };
          // play() returns a promise in browsers; older engines return nothing.
          Promise.resolve(audio.play()).catch((e: Error) => error(e.message));
        },
        (e: Error) => !cancelled && error(e.message),
      );
      return () => {
        cancelled = true;
        audio?.pause();
        release();
      };
    },
  };
}
