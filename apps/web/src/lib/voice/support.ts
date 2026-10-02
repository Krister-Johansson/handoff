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
