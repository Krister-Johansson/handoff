import type { RecognitionCtor } from "./support";

/** The part of a SpeechRecognition instance the dashboard uses. */
export type Recognizer = EventTarget & {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  start(): void;
  stop(): void;
  abort(): void;
};

export type OnDevice = "available" | "downloadable" | "downloading" | "unavailable" | "unknown";

/** Whether the language can be recognized on this machine; "unknown" when the browser cannot say. */
export async function checkOnDevice(ctor: RecognitionCtor, lang: string): Promise<OnDevice> {
  if (typeof ctor.available !== "function") return "unknown";
  try {
    return await ctor.available({ langs: [lang], processLocally: true });
  } catch {
    return "unavailable";
  }
}

/** Asks Chrome to install the language's on-device pack. Must run from a click. */
export async function installOnDevice(ctor: RecognitionCtor, lang: string): Promise<boolean> {
  if (typeof ctor.install !== "function") return false;
  try {
    return await ctor.install({ langs: [lang], processLocally: true });
  } catch {
    return false;
  }
}

export function createRecognizer(ctor: RecognitionCtor, options: { lang: string; continuous: boolean; processLocally: boolean }): Recognizer {
  const recognizer = new ctor() as Recognizer;
  recognizer.lang = options.lang;
  recognizer.continuous = options.continuous;
  recognizer.interimResults = true;
  recognizer.processLocally = options.processLocally;
  return recognizer;
}

const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], { type: "language" });

/** A language tag as people say it, "British English" for en-GB. */
export function languageName(lang: string): string {
  try {
    return LANGUAGE_NAMES.of(lang) ?? lang;
  } catch {
    return lang;
  }
}

export type RecognizerHandlers = { start(): void; result(event: Event): void; error(code: string): void; end(): void };

/** Listens to a recognizer's events until `signal` aborts. */
export function onRecognizer(recognizer: Recognizer, handlers: RecognizerHandlers, signal: AbortSignal) {
  recognizer.addEventListener("start", () => handlers.start(), { signal });
  recognizer.addEventListener("result", (event) => handlers.result(event), { signal });
  recognizer.addEventListener("error", (event) => handlers.error((event as Event & { error: string }).error), { signal });
  recognizer.addEventListener("end", () => handlers.end(), { signal });
}
