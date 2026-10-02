import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { POST as speak } from "./speak/route";

const upstream = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
beforeEach(() => {
  vi.stubGlobal("fetch", upstream);
  upstream.mockReset();
  vi.stubEnv("ELEVENLABS_API_KEY", "sk_test_key");
  vi.stubEnv("HANDOFF_ELEVENLABS_MODEL", "");
  vi.stubEnv("HANDOFF_ELEVENLABS_VOICE_ID", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const post = (body: unknown, origin = "http://127.0.0.1:3000") =>
  new Request("http://127.0.0.1:3000/api/voice/speak", { method: "POST", headers: { origin, host: "127.0.0.1:3000", "content-type": "application/json" }, body: JSON.stringify(body) });

test("refuses another origin, answers 503 without a key, and returns ElevenLabs' audio for a sentence without exposing the key", async () => {
  expect((await speak(post({ text: "Hi.", voiceId: "v1" }, "https://evil.example"))).status).toBe(403);
  expect((await speak(post({ text: "", voiceId: "v1" }))).status).toBe(400);
  expect((await speak(post({ text: "x".repeat(1001), voiceId: "v1" }))).status).toBe(400);
  expect((await speak(post({ text: "Hi.", voiceId: "../x" }))).status).toBe(400);
  expect(upstream).not.toHaveBeenCalled();

  upstream.mockResolvedValueOnce(new Response(new Uint8Array([0xff, 0xf3, 1, 2]), { headers: { "content-type": "audio/mpeg" } }));
  const response = await speak(post({ text: "Two runs wait.", voiceId: "JBFqnCBsd6RMkjVDRZzb" }));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("audio/mpeg");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xf3, 1, 2]));
  const [url, init] = upstream.mock.calls[0]!;
  expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb/stream?output_format=mp3_44100_128");
  expect(new Headers(init.headers).get("xi-api-key")).toBe("sk_test_key");
  expect(JSON.parse(String(init.body))).toEqual({ text: "Two runs wait.", model_id: "eleven_flash_v2_5" });
  expect(JSON.stringify([...response.headers])).not.toContain("sk_test_key");

  upstream.mockResolvedValueOnce(new Response(JSON.stringify({ detail: { message: "Invalid API key" } }), { status: 401 }));
  const refused = await speak(post({ text: "Hi.", voiceId: "v1" }));
  expect(refused.status).toBe(502);
  expect(await refused.json()).toEqual({ error: "ElevenLabs answered 401." });

  vi.stubEnv("ELEVENLABS_API_KEY", "");
  const off = await speak(post({ text: "Hi.", voiceId: "v1" }));
  expect(off.status).toBe(503);
  expect(await off.json()).toEqual({ error: "Add ELEVENLABS_API_KEY to the dashboard's environment and restart it." });
});


test("without a chosen voice it speaks with HANDOFF_ELEVENLABS_VOICE_ID, or else the account's first voice", async () => {
  vi.stubEnv("HANDOFF_ELEVENLABS_VOICE_ID", "envVoice");
  upstream.mockResolvedValueOnce(new Response(new Uint8Array([1]), { headers: { "content-type": "audio/mpeg" } }));
  await speak(post({ text: "Hi." }));
  expect(upstream.mock.calls[0]![0]).toContain("/text-to-speech/envVoice/stream");

  vi.stubEnv("HANDOFF_ELEVENLABS_VOICE_ID", "");
  upstream.mockResolvedValueOnce(Response.json({ voices: [{ voice_id: "zed", name: "Zed" }, { voice_id: "amy", name: "Amy" }] }));
  upstream.mockResolvedValueOnce(new Response(new Uint8Array([1]), { headers: { "content-type": "audio/mpeg" } }));
  await speak(post({ text: "Hi." }));
  expect(upstream.mock.calls[2]![0]).toContain("/text-to-speech/amy/stream");
});
