import type { VoicePrefs } from "./prefs";

/** Replies come first, then notifications, then long reads, which resume where they were. */
export type SpeechPriority = "reply" | "notification" | "read";

export type SpeakerState = {
  speaking: boolean;
  title?: string;
  priority?: SpeechPriority;
  /** The sentence being spoken, from 1, and how many the text has. */
  sentence: number;
  total: number;
  error?: string;
};

export type Speaker = {
  speak(text: string, options: { priority: SpeechPriority; title?: string }): void;
  stop(): void;
  isSpeaking(): boolean;
  getState(): SpeakerState;
  subscribe(listener: () => void): () => void;
};

/**
 * Speaks one sentence and calls `end` or `error` once; the returned function cancels it. `prefetch`
 * prepares the next sentence while this one plays, for engines that fetch audio.
 */
export type Player = {
  play(sentence: string, prefs: VoicePrefs, handlers: { end(): void; error(message: string): void }): () => void;
  prefetch?(sentence: string, prefs: VoicePrefs): void;
};

const RANK: Record<SpeechPriority, number> = { reply: 0, notification: 1, read: 2 };
const ABBREVIATIONS = new Set(["e.g", "i.e", "etc", "vs", "mr", "mrs", "ms", "dr", "no", "fig"]);

/** Markdown as it is read aloud: no markup, links as their text, code blocks named and skipped. */
function plain(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, "\n\nCode block skipped.\n\n")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*|__/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "");
}

/**
 * Text split into the sentences the speaker says one at a time: each line on its own (headings and
 * list items have no full stop), then at a full stop, question or exclamation mark followed by a
 * space, unless the word before it is an abbreviation. Sentences may start lowercase (node names).
 */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  for (const line of plain(text).split(/\n+/)) {
    let rest = line.trim();
    while (rest) {
      let cut = -1;
      for (const match of rest.matchAll(/[.!?]+(?=\s+\S)/g)) {
        const word = rest.slice(0, match.index).split(/\s+/).at(-1)?.toLowerCase() ?? "";
        if (match[0] === "." && ABBREVIATIONS.has(word)) continue;
        cut = match.index + match[0].length;
        break;
      }
      if (cut < 0) {
        sentences.push(rest);
        break;
      }
      sentences.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
  }
  return sentences.filter(Boolean);
}

/** A reply as it is spoken: at most `max` sentences, then a pointer to the rest on screen. */
export function spokenReply(text: string, max = 3): string {
  const sentences = splitSentences(text);
  return sentences.length <= max ? sentences.join(" ") : `${sentences.slice(0, max).join(" ")} The rest is on screen.`;
}

type Job = { priority: SpeechPriority; title?: string; sentences: string[]; next: number; seq: number };

const IDLE: SpeakerState = { speaking: false, sentence: 0, total: 0 };

/**
 * Speaks text one sentence at a time through the player (ElevenLabs, through the dashboard), so a stop
 * is immediate and a higher priority can go first between sentences, and fetches the next sentence
 * while one plays. A sentence that cannot be spoken ends the speech with its reason. Nothing is spoken
 * until speak() is called.
 */
export function createSpeaker(player: Player, getPrefs: () => VoicePrefs): Speaker {
  let jobs: Job[] = [];
  let stopCurrent: (() => void) | undefined;
  // Each sentence gets a number; a late end or error from an earlier one is ignored.
  let sentenceNo = 0;
  let state: SpeakerState = IDLE;
  let seq = 0;
  const listeners = new Set<() => void>();
  const set = (next: SpeakerState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const pending = () => jobs.filter((j) => j.next < j.sentences.length).toSorted((a, b) => RANK[a.priority] - RANK[b.priority] || a.seq - b.seq);

  const next = () => {
    jobs = jobs.filter((j) => j.next < j.sentences.length);
    const job = pending()[0];
    if (!job) {
      stopCurrent = undefined;
      return set(IDLE);
    }
    const mine = ++sentenceNo;
    const alive = () => sentenceNo === mine;
    const prefs = getPrefs();
    const sentence = job.sentences[job.next++]!;
    set({ speaking: true, priority: job.priority, sentence: job.next, total: job.sentences.length, ...(job.title ? { title: job.title } : {}) });
    stopCurrent = player.play(sentence, prefs, {
      end: () => alive() && next(),
      error: (message) => {
        if (!alive()) return;
        jobs = [];
        stopCurrent = undefined;
        set({ ...IDLE, error: message });
      },
    });
    const after = pending()[0];
    if (after) player.prefetch?.(after.sentences[after.next]!, prefs);
  };

  return {
    speak(text, { priority, title }) {
      const sentences = splitSentences(text);
      if (!sentences.length) return;
      jobs.push({ priority, sentences, next: 0, seq: seq++, ...(title ? { title } : {}) });
      if (!state.speaking) next();
    },
    stop() {
      sentenceNo++;
      jobs = [];
      const stopping = stopCurrent;
      stopCurrent = undefined;
      stopping?.();
      set(IDLE);
    },
    isSpeaking: () => state.speaking,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
