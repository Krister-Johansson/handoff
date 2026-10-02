import { expect, test } from "vitest";
import { detectVoiceSupport } from "./support";

class Recognition {}
class OnDeviceRecognition {
  static available() {
    return Promise.resolve("available");
  }
}

test("detectVoiceSupport finds the webkit-prefixed constructor", () => {
  const support = detectVoiceSupport({ webkitSpeechRecognition: Recognition } as never);
  expect(support.recognition).toBe(Recognition);
  expect(support.synth).toBeUndefined();
});

test("detectVoiceSupport reports no on-device check when available() is missing", () => {
  expect(detectVoiceSupport({ SpeechRecognition: Recognition } as never).onDeviceCheck).toBe(false);
  expect(detectVoiceSupport({ SpeechRecognition: OnDeviceRecognition } as never).onDeviceCheck).toBe(true);
  // The unprefixed constructor wins over the prefixed one.
  expect(detectVoiceSupport({ SpeechRecognition: OnDeviceRecognition, webkitSpeechRecognition: Recognition } as never).recognition).toBe(OnDeviceRecognition);
});

test("detectVoiceSupport finds speech synthesis and reports nothing in a window without either", () => {
  const synth = { getVoices: () => [] };
  expect(detectVoiceSupport({ speechSynthesis: synth } as never)).toEqual({ synth, onDeviceCheck: false });
  expect(detectVoiceSupport({} as never)).toEqual({ onDeviceCheck: false });
});
