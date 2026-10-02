import type { VoicePrefs } from "../prefs";
import type { Player } from "../speaker";

/** A stand-in for the ElevenLabs player: it records what it plays and prefetches, and ends or fails a sentence on command. */
export class FakePlayer implements Player {
  spoken: string[] = [];
  prefetched: string[] = [];
  cancels = 0;
  lastPrefs: VoicePrefs | undefined;
  private handlers: { end(): void; error(message: string): void } | undefined;

  play(sentence: string, prefs: VoicePrefs, handlers: { end(): void; error(message: string): void }) {
    this.spoken.push(sentence);
    this.lastPrefs = prefs;
    this.handlers = handlers;
    return () => {
      this.cancels++;
      this.handlers = undefined;
    };
  }
  prefetch(sentence: string) {
    this.prefetched.push(sentence);
  }
  finishCurrent() {
    const handlers = this.handlers;
    this.handlers = undefined;
    handlers?.end();
  }
  failCurrent(message: string) {
    const handlers = this.handlers;
    this.handlers = undefined;
    handlers?.error(message);
  }
}
