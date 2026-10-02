/** An utterance the fake keeps: the text and settings it was spoken with, and its end and error handlers. */
export class FakeUtterance {
  voice: SpeechSynthesisVoice | null = null;
  lang = "";
  rate = 1;
  onend: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(readonly text: string) {}
}

export const fakeVoice = (name: string, lang: string, localService = true) => ({ name, lang, localService, voiceURI: name, default: false }) as SpeechSynthesisVoice;

/**
 * A stand-in for window.speechSynthesis. It speaks one utterance at a time as the browser does;
 * finishCurrent and errorCurrent end the one being spoken.
 */
export class FakeSpeechSynthesis extends EventTarget {
  spoken: FakeUtterance[] = [];
  queue: FakeUtterance[] = [];
  cancels = 0;
  constructor(public voices: SpeechSynthesisVoice[] = [fakeVoice("Samantha", "en-US")]) {
    super();
  }
  get speaking() {
    return this.queue.length > 0;
  }
  getVoices() {
    return this.voices;
  }
  speak(utterance: FakeUtterance) {
    this.spoken.push(utterance);
    this.queue.push(utterance);
  }
  cancel() {
    this.cancels++;
    this.queue = [];
  }
  get current() {
    return this.queue[0];
  }
  finishCurrent() {
    const utterance = this.queue.shift();
    utterance?.onend?.(new Event("end"));
  }
  errorCurrent(error = "synthesis-failed") {
    const utterance = this.queue.shift();
    utterance?.onerror?.(Object.assign(new Event("error"), { error }));
  }
  fireVoicesChanged() {
    this.dispatchEvent(new Event("voiceschanged"));
  }
}
