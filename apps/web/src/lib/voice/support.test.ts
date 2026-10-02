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
});

test("detectVoiceSupport reports no on-device check when available() is missing", () => {
  expect(detectVoiceSupport({ SpeechRecognition: Recognition } as never).onDeviceCheck).toBe(false);
  expect(detectVoiceSupport({ SpeechRecognition: OnDeviceRecognition } as never).onDeviceCheck).toBe(true);
  // The unprefixed constructor wins over the prefixed one.
  expect(detectVoiceSupport({ SpeechRecognition: OnDeviceRecognition, webkitSpeechRecognition: Recognition } as never).recognition).toBe(OnDeviceRecognition);
});

test("detectVoiceSupport reports nothing in a window without recognition", () => {
  expect(detectVoiceSupport({} as never)).toEqual({ onDeviceCheck: false });
});
