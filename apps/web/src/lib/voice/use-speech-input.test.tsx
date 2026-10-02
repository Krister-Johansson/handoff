import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { RecognitionCtor } from "./support";
import { FakeSpeechRecognition, FakeSpeechRecognitionPhrase } from "./testing/fake-speech-recognition";
import { useSpeechInput, type SpeechInputOptions } from "./use-speech-input";

const ctor = FakeSpeechRecognition as unknown as RecognitionCtor;
const latest = () => FakeSpeechRecognition.instances.at(-1)!;

beforeEach(() => FakeSpeechRecognition.reset());

function setup(options: Partial<SpeechInputOptions> = {}) {
  const onFinal = vi.fn();
  const hook = renderHook(() => useSpeechInput({ ctor, lang: "en-GB", allowServer: false, onFinal, ...options }));
  return { ...hook, onFinal };
}

test("start creates a recognizer with processLocally true, interimResults true and the configured lang", async () => {
  const { result } = setup();
  await act(() => result.current.start("command"));
  expect(FakeSpeechRecognition.availableCalls).toEqual([{ langs: ["en-GB"], processLocally: true }]);
  expect(latest()).toMatchObject({ processLocally: true, interimResults: true, continuous: false, lang: "en-GB", starts: 1 });
  act(() => latest().emitStart());
  expect(result.current.state).toBe("listening");
});

test("start with server recognition allowed and no on-device pack creates a recognizer with processLocally false", async () => {
  FakeSpeechRecognition.availability = "unavailable";
  const { result } = setup({ allowServer: true });
  await act(() => result.current.start("command"));
  expect(latest()).toMatchObject({ processLocally: false, starts: 1 });
});

test("start with no pack and server recognition off does not create a recognizer and reports downloadable", async () => {
  FakeSpeechRecognition.availability = "downloadable";
  const { result } = setup();
  await act(() => result.current.start("command"));
  expect(FakeSpeechRecognition.instances).toEqual([]);
  expect(result.current.state).toBe("downloadable");
  // Installing the pack from a click, then starting, works.
  await act(() => result.current.install());
  expect(FakeSpeechRecognition.installed).toEqual([{ langs: ["en-GB"], processLocally: true }]);
  expect(latest()).toMatchObject({ processLocally: true, starts: 1 });
});

test("a language with no on-device pack and server recognition off says so", async () => {
  FakeSpeechRecognition.availability = "unavailable";
  const { result } = setup();
  await act(() => result.current.start("command"));
  expect(FakeSpeechRecognition.instances).toEqual([]);
  expect(result.current).toMatchObject({ state: "unavailable", error: expect.stringContaining("server-based recognition") });
});

test("interim results update interim and final results call onFinal once", async () => {
  const { result, onFinal } = setup();
  await act(() => result.current.start("command"));
  act(() => latest().emitStart());
  act(() => latest().emitResult("open the", false));
  expect(result.current.interim).toBe("open the");
  expect(onFinal).not.toHaveBeenCalled();
  act(() => latest().emitResult("open the inbox", true));
  act(() => latest().emitEnd());
  expect(onFinal).toHaveBeenCalledTimes(1);
  expect(onFinal).toHaveBeenCalledWith("open the inbox", "command");
  expect(result.current).toMatchObject({ state: "idle", interim: "" });
});

test("abort discards a final result that arrives after it", async () => {
  const { result, onFinal } = setup();
  await act(() => result.current.start("command"));
  act(() => latest().emitStart());
  act(() => latest().emitResult("cancel every", false));
  act(() => result.current.abort());
  expect(latest().aborted).toBe(true);
  act(() => latest().emitResult("cancel every run", true));
  act(() => latest().emitEnd());
  expect(onFinal).not.toHaveBeenCalled();
  expect(result.current).toMatchObject({ state: "idle", interim: "" });
});

test("an error not-allowed sets state blocked with a readable message", async () => {
  const { result } = setup();
  await act(() => result.current.start("command"));
  act(() => latest().emitError("not-allowed"));
  act(() => latest().emitEnd());
  expect(result.current).toMatchObject({ state: "blocked", error: "Chrome blocked the microphone. Allow it in the site settings." });
  // The person can try again after changing the site setting.
  await act(() => result.current.start("command"));
  expect(FakeSpeechRecognition.instances).toHaveLength(2);
});

test("dictation mode restarts once when the recognizer ends on its own and not after stop", async () => {
  const { result, onFinal } = setup();
  await act(() => result.current.start("dictation"));
  const recognizer = latest();
  expect(recognizer).toMatchObject({ continuous: true, interimResults: true });
  act(() => recognizer.emitStart());
  act(() => recognizer.emitResult("Use the Read tool", true));
  expect(onFinal).toHaveBeenCalledWith("Use the Read tool", "dictation");
  // Chrome ends the session after a pause; dictation goes on.
  act(() => recognizer.emitEnd());
  expect(recognizer.starts).toBe(2);
  expect(result.current.state).toBe("listening");
  act(() => result.current.stop());
  expect(recognizer.stopped).toBe(true);
  act(() => recognizer.emitEnd());
  expect(recognizer.starts).toBe(2);
  expect(result.current.state).toBe("idle");
});

const phrases = (recognizer: FakeSpeechRecognition) => recognizer.phrases.map((p) => ({ ...(p as FakeSpeechRecognitionPhrase) }));

test("phrases are set from the registry only when processLocally is true", async () => {
  vi.stubGlobal("SpeechRecognitionPhrase", FakeSpeechRecognitionPhrase);
  try {
    const local = setup({ phrases: () => ["sandbox", "coder", "sandbox"] });
    await act(() => local.result.current.start("command"));
    expect(phrases(latest())).toEqual([
      { phrase: "sandbox", boost: 2 },
      { phrase: "coder", boost: 2 },
    ]);

    FakeSpeechRecognition.availability = "unavailable";
    const server = setup({ allowServer: true, phrases: () => ["sandbox"] });
    await act(() => server.result.current.start("command"));
    expect(latest()).toMatchObject({ processLocally: false });
    expect(phrases(latest())).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("phrases-not-supported clears the list and listening continues", async () => {
  vi.stubGlobal("SpeechRecognitionPhrase", FakeSpeechRecognitionPhrase);
  try {
    const { result, onFinal } = setup({ phrases: () => ["sandbox"] });
    await act(() => result.current.start("command"));
    const recognizer = latest();
    act(() => recognizer.emitStart());
    act(() => recognizer.emitError("phrases-not-supported"));
    expect(recognizer.phrases).toEqual([]);
    expect(result.current.error).toBeUndefined();
    // Chrome ends the session; it starts again without the phrases and hears the person.
    act(() => recognizer.emitEnd());
    expect(recognizer.starts).toBe(2);
    expect(result.current.state).toBe("listening");
    act(() => recognizer.emitResult("open sandbox", true));
    act(() => recognizer.emitEnd());
    expect(onFinal).toHaveBeenCalledWith("open sandbox", "command");
    expect(result.current.state).toBe("idle");
    // The next session does not try phrases again.
    await act(() => result.current.start("command"));
    expect(latest().phrases).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("unspokenPunctuation is set only when the property exists", async () => {
  class WithPunctuation extends FakeSpeechRecognition {
    unspokenPunctuation = false;
  }
  const plain = setup();
  await act(() => plain.result.current.start("dictation"));
  expect("unspokenPunctuation" in latest()).toBe(false);
  act(() => plain.result.current.abort());

  const punctuating = setup({ ctor: WithPunctuation as unknown as RecognitionCtor });
  await act(() => punctuating.result.current.start("dictation"));
  expect(latest()).toMatchObject({ unspokenPunctuation: true, continuous: true });
  act(() => punctuating.result.current.abort());
  // A command is one short utterance; punctuation is for dictated text.
  await act(() => punctuating.result.current.start("command"));
  expect(latest()).toMatchObject({ unspokenPunctuation: false });
});
