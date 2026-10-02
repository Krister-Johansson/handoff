import { useSyncExternalStore } from "react";

/** A SpeechRecognition constructor, with Chrome's on-device check when the browser has it. */
export type RecognitionCtor = (new () => unknown) & {
  available?: (options: { langs: string[]; processLocally: boolean; quality?: string }) => Promise<"available" | "downloadable" | "downloading" | "unavailable">;
  install?: (options: { langs: string[]; processLocally: boolean; quality?: string }) => Promise<boolean>;
};

export type VoiceSupport = {
  recognition?: RecognitionCtor;
  /** Whether the browser can say if an on-device language pack exists (`SpeechRecognition.available`). */
  onDeviceCheck: boolean;
};

type VoiceWindow = { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };

/** What this browser offers for listening: recognition (unprefixed first) and the on-device check. Speaking is ElevenLabs. */
export function detectVoiceSupport(win: VoiceWindow): VoiceSupport {
  const recognition = win.SpeechRecognition ?? win.webkitSpeechRecognition;
  return {
    ...(recognition ? { recognition } : {}),
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
