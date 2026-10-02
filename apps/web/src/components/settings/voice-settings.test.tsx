import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readVoicePrefs } from "@/lib/voice/prefs";
import type { VoiceSupport } from "@/lib/voice/support";
import { VoiceSettings } from "./voice-settings";

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const VOICES = { voices: [{ id: "v1", name: "George" }, { id: "v2", name: "Rachel" }] };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

class OnDevice {
  static available = async () => "available" as const;
}

test("the Voice tab says recognition is unavailable when no constructor exists and keeps the speaking switches", () => {
  render(<VoiceSettings support={{ onDeviceCheck: false }} elevenLabs={VOICES} />);
  expect(screen.getByRole("note")).toHaveTextContent(
    "This browser has no speech recognition, so the microphone button and V are not available. Chrome on Windows, macOS or Linux supports it. Replies and notifications can still be read aloud.",
  );
  expect(screen.getByRole("switch", { name: "Server-based recognition" })).toBeDisabled();
  expect(screen.getByLabelText("Language")).toBeDisabled();
  expect(screen.getByText("Listening")).toBeInTheDocument();
  expect(screen.getByText("Speaking")).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "Speak replies" })).toBeEnabled();
  expect(screen.getByRole("switch", { name: "Speak notifications" })).toBeEnabled();
});

test("turning on server recognition writes allowServerRecognition true, and without ElevenLabs the speaking settings say what to add", () => {
  render(<VoiceSettings support={{ recognition: OnDevice as unknown as VoiceSupport["recognition"], onDeviceCheck: true }} />);
  const toggle = screen.getByRole("switch", { name: "Server-based recognition" });
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  expect(readVoicePrefs().allowServerRecognition).toBe(true);
  expect(screen.getByText(/Add ELEVENLABS_API_KEY to the dashboard's environment and restart it\./)).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "Speak replies" })).toBeDisabled();
  expect(screen.queryByLabelText("ElevenLabs voice")).not.toBeInTheDocument();
});

test("the Voice tab lists the voice shortcuts", () => {
  render(<VoiceSettings support={{ recognition: OnDevice as unknown as VoiceSupport["recognition"], onDeviceCheck: true }} elevenLabs={VOICES} />);
  const shortcuts = screen.getByRole("list", { name: "Voice shortcuts" });
  expect(within(shortcuts).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
    "VOutside a text field: ask the assistant. The voice bubble listens for one question.",
    "Microphone buttonIn a text field: dictate into it until you stop. What you say goes in at the caret.",
    "EscapeStop speaking, then stop listening, then close the voice bubble.",
  ]);
  expect(screen.getByText(/A screen reader and the dashboard's voice can speak at the same time\./)).toBeInTheDocument();
});

test("a browser without the on-device check says listening needs server recognition", () => {
  render(<VoiceSettings support={{ recognition: class {} as unknown as VoiceSupport["recognition"], onDeviceCheck: false }} elevenLabs={VOICES} />);
  expect(screen.getByText(/cannot check for on-device recognition/)).toBeInTheDocument();
});

test("the ElevenLabs voices come from the server, the choice and rate are kept, and Test voice speaks with them", async () => {
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:1", revokeObjectURL: vi.fn() }));
  render(<VoiceSettings support={{ onDeviceCheck: false }} elevenLabs={VOICES} />);
  expect(screen.getByText("The dashboard speaks with ElevenLabs: the text read aloud goes to ElevenLabs.")).toBeInTheDocument();
  const select = screen.getByLabelText("ElevenLabs voice");
  expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Default voice", "George", "Rachel"]);
  fireEvent.change(select, { target: { value: "v2" } });
  fireEvent.change(screen.getByLabelText("Rate"), { target: { value: "1.25" } });
  expect(readVoicePrefs()).toMatchObject({ elevenLabsVoiceId: "v2", rate: 1.25 });
  expect(within(screen.getByLabelText("Rate")).getByRole("option", { name: "1x, normal" })).toBeInTheDocument();

  fetchMock.mockResolvedValueOnce(new Response(new Blob([new Uint8Array([1])])));
  fireEvent.click(screen.getByRole("button", { name: "Test voice" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith("/api/voice/speak", expect.objectContaining({ body: JSON.stringify({ text: "This is how handoff sounds.", voiceId: "v2" }) })),
  );
});

test("when the server could not list ElevenLabs voices the row says why", () => {
  render(<VoiceSettings support={{ onDeviceCheck: false }} elevenLabs={{ error: "ElevenLabs answered 401." }} />);
  expect(screen.getByText("ElevenLabs answered 401.")).toBeInTheDocument();
  expect(screen.getByLabelText("ElevenLabs voice")).toBeDisabled();
});

test("Also finished and merged runs is a checkbox available only while notifications are spoken", () => {
  render(<VoiceSettings support={{ onDeviceCheck: false }} elevenLabs={VOICES} />);
  expect(screen.getByRole("checkbox", { name: "Also finished and merged runs" })).toBeDisabled();
  fireEvent.click(screen.getByRole("switch", { name: "Speak notifications" }));
  const also = screen.getByRole("checkbox", { name: "Also finished and merged runs" });
  expect(also).toBeEnabled();
  fireEvent.click(also);
  expect(readVoicePrefs()).toMatchObject({ speakNotifications: true, speakFinished: true });
});
