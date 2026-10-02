import { useSyncExternalStore } from "react";

/** A SpeechRecognition constructor, with Chrome's on-device check when the browser has it. */
export type RecognitionCtor = (new () => unknown) & {
  available?: (options: { langs: string[]; processLocally: boolean; quality?: string }) => Promise<"available" | "downloadable" | "downloading" | "unavailable">;
  install?: (options: { langs: string[]; processLocally: boolean; quality?: string }) => Promise<boolean>;
};

export type VoiceSupport = {
  recognition?: RecognitionCtor;
  synth?: SpeechSynthesis;
  /** Whether the browser can say if an on-device language pack exists (`SpeechRecognition.available`). */
  onDeviceCheck: boolean;
};

type VoiceWindow = { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor; speechSynthesis?: SpeechSynthesis };

/** What this browser offers for voice: recognition (unprefixed first), synthesis, and the on-device check. */
export function detectVoiceSupport(win: VoiceWindow): VoiceSupport {
  const recognition = win.SpeechRecognition ?? win.webkitSpeechRecognition;
  const synth = win.speechSynthesis;
  return {
    ...(recognition ? { recognition } : {}),
    ...(synth ? { synth } : {}),
    onDeviceCheck: typeof recognition?.available === "function",
  };
}

const NO_SUPPORT: VoiceSupport = { onDeviceCheck: false };
let detected: VoiceSupport | undefined;
const noSubscribe = () => () => {};

/** This browser's voice support, detected once; nothing on the server, so the first render matches it. */
export function useVoiceSupport(): VoiceSupport {
  return useSyncExternalStore(
    noSubscribe,
    () => (detected ??= detectVoiceSupport(globalThis as never)),
    () => NO_SUPPORT,
  );
}
