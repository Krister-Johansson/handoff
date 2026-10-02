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

/**
 * The voice to speak with: the stored one while it still exists (and is allowed), else a voice on
 * this machine for the language, else any voice on this machine. Remote voices only when allowed.
 */
export function pickVoice(voices: SpeechSynthesisVoice[], prefs: VoicePrefs): SpeechSynthesisVoice | undefined {
  const usable = voices.filter((v) => v.localService || prefs.allowRemoteVoices);
  const stored = prefs.voiceURI ? usable.find((v) => v.voiceURI === prefs.voiceURI) : undefined;
  if (stored) return stored;
  const local = usable.filter((v) => v.localService);
  return local.find((v) => v.lang === prefs.lang) ?? local[0] ?? usable.find((v) => v.lang === prefs.lang) ?? usable[0];
}

type Job = { priority: SpeechPriority; title?: string; sentences: string[]; next: number; seq: number };

const IDLE: SpeakerState = { speaking: false, sentence: 0, total: 0 };

/**
 * Speaks text one sentence at a time through speechSynthesis, so a stop is immediate and a higher
 * priority can go first between sentences. Nothing is spoken until speak() is called.
 */
export function createSpeaker(
  synth: SpeechSynthesis,
  getPrefs: () => VoicePrefs,
  makeUtterance: (text: string) => SpeechSynthesisUtterance = (text) => new SpeechSynthesisUtterance(text),
): Speaker {
  let jobs: Job[] = [];
  let current: SpeechSynthesisUtterance | undefined;
  let state: SpeakerState = IDLE;
  let seq = 0;
  const listeners = new Set<() => void>();
  const set = (next: SpeakerState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const next = () => {
    jobs = jobs.filter((j) => j.next < j.sentences.length);
    const job = jobs.toSorted((a, b) => RANK[a.priority] - RANK[b.priority] || a.seq - b.seq)[0];
    if (!job) {
      current = undefined;
      return set(IDLE);
    }
    const prefs = getPrefs();
    const voice = pickVoice(synth.getVoices(), prefs);
    if (!voice) {
      jobs = [];
      current = undefined;
      return set({ ...IDLE, error: `No local voice for ${prefs.lang}.` });
    }
    const utterance = makeUtterance(job.sentences[job.next++]!);
    utterance.voice = voice;
    utterance.lang = prefs.lang;
    utterance.rate = prefs.rate;
    const done = () => {
      if (utterance !== current) return;
      next();
    };
    utterance.onend = done;
    utterance.onerror = done;
    current = utterance;
    set({ speaking: true, priority: job.priority, sentence: job.next, total: job.sentences.length, ...(job.title ? { title: job.title } : {}) });
    synth.speak(utterance);
  };

  return {
    speak(text, { priority, title }) {
      const sentences = splitSentences(text);
      if (!sentences.length) return;
      jobs.push({ priority, sentences, next: 0, seq: seq++, ...(title ? { title } : {}) });
      if (!current) next();
    },
    stop() {
      jobs = [];
      current = undefined;
      synth.cancel();
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
