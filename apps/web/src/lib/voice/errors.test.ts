import { expect, test } from "vitest";
import { voiceErrorMessage } from "./errors";

test("each recognition error reads as a sentence, and an unknown one still says what happened", () => {
  expect(voiceErrorMessage("not-allowed")).toBe("Chrome blocked the microphone. Allow it in the site settings.");
  expect(voiceErrorMessage("audio-capture")).toMatch(/microphone/);
  expect(voiceErrorMessage("no-speech")).toMatch(/heard nothing/i);
  expect(voiceErrorMessage("network")).toMatch(/network/i);
  expect(voiceErrorMessage("something-new")).toBe("Speech recognition stopped (something-new).");
});
