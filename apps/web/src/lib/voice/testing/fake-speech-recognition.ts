type Availability = "available" | "downloadable" | "downloading" | "unavailable";

type ResultInit = { transcript: string; isFinal: boolean };

/**
 * A stand-in for Chrome's SpeechRecognition. Tests set the on-device availability, then drive each
 * created recognizer by hand: emitStart, emitResult, emitError, emitEnd.
 */
export class FakeSpeechRecognition extends EventTarget {
  static instances: FakeSpeechRecognition[] = [];
  static availability: Availability = "available";
  static installed: { langs: string[]; processLocally: boolean }[] = [];
  static installResult = true;
  static availableCalls: { langs: string[]; processLocally: boolean }[] = [];

  static reset() {
    FakeSpeechRecognition.instances = [];
    FakeSpeechRecognition.availability = "available";
    FakeSpeechRecognition.installed = [];
    FakeSpeechRecognition.installResult = true;
    FakeSpeechRecognition.availableCalls = [];
  }
  static async available(options: { langs: string[]; processLocally: boolean }) {
    FakeSpeechRecognition.availableCalls.push(options);
    return FakeSpeechRecognition.availability;
  }
  static async install(options: { langs: string[]; processLocally: boolean }) {
    FakeSpeechRecognition.installed.push(options);
    if (FakeSpeechRecognition.installResult) FakeSpeechRecognition.availability = "available";
    return FakeSpeechRecognition.installResult;
  }

  lang = "";
  continuous = false;
  interimResults = false;
  processLocally = false;
  starts = 0;
  stopped = false;
  aborted = false;
  private results: ResultInit[] = [];

  constructor() {
    super();
    FakeSpeechRecognition.instances.push(this);
  }
  start() {
    this.starts++;
  }
  stop() {
    this.stopped = true;
  }
  abort() {
    this.aborted = true;
  }

  emitStart() {
    this.dispatchEvent(new Event("start"));
  }
  /** Adds a result at the end of the list, as Chrome does, and fires result from it. */
  emitResult(transcript: string, isFinal: boolean) {
    // An interim result is replaced by the next result for the same utterance.
    if (this.results.at(-1) && !this.results.at(-1)!.isFinal) this.results.pop();
    this.results.push({ transcript, isFinal });
    const list = this.results.map((r) => Object.assign([{ transcript: r.transcript, confidence: 0.9 }], { isFinal: r.isFinal }));
    this.dispatchEvent(Object.assign(new Event("result"), { resultIndex: this.results.length - 1, results: list }));
  }
  emitError(error: string) {
    this.dispatchEvent(Object.assign(new Event("error"), { error, message: "" }));
  }
  emitEnd() {
    this.dispatchEvent(new Event("end"));
  }
}
