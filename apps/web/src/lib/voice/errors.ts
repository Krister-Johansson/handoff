const MESSAGES: Record<string, string> = {
  "not-allowed": "Chrome blocked the microphone. Allow it in the site settings.",
  "service-not-allowed": "Chrome does not allow speech recognition here. Check the site settings.",
  "audio-capture": "No microphone was found, or another app is using it.",
  "no-speech": "Heard nothing. Try again a little closer to the microphone.",
  network: "Speech recognition needs the network for server-based recognition, and the network failed.",
  "language-not-supported": "This language is not supported for speech recognition.",
  "phrases-not-supported": "This browser cannot bias recognition toward the page's commands.",
  aborted: "Listening stopped.",
};

/** A `SpeechRecognitionErrorEvent.error` code as a sentence for the transcript strip. */
export function voiceErrorMessage(code: string): string {
  return MESSAGES[code] ?? `Speech recognition stopped (${code}).`;
}
