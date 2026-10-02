import { isSameLocalOrigin } from "@/server/local-request";
import { elevenLabsConfig, firstVoice, MAX_SPEAK_CHARS, NO_KEY, speakWithElevenLabs } from "@/server/voice/elevenlabs";

export const dynamic = "force-dynamic";

const VOICE_ID = /^[A-Za-z0-9]{1,64}$/;

/**
 * Speaks one sentence with ElevenLabs for the dashboard's voice: the browser sends the text and,
 * optionally, the voice (else HANDOFF_ELEVENLABS_VOICE_ID or the account's first voice); the key stays
 * here and the MP3 comes back. Only the local dashboard may call it.
 */
export async function POST(request: Request) {
  if (!isSameLocalOrigin(request.headers.get("origin"), request.headers.get("host"))) return Response.json({ error: "forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { text?: unknown; voiceId?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > MAX_SPEAK_CHARS) return Response.json({ error: `Send one sentence of 1 to ${MAX_SPEAK_CHARS} characters.` }, { status: 400 });
  if (body.voiceId !== undefined && body.voiceId !== null && (typeof body.voiceId !== "string" || !VOICE_ID.test(body.voiceId))) {
    return Response.json({ error: "That is not an ElevenLabs voice id." }, { status: 400 });
  }
  const { apiKey, model, defaultVoiceId } = elevenLabsConfig();
  if (!apiKey) return Response.json({ error: NO_KEY }, { status: 503 });
  const voiceId = typeof body.voiceId === "string" ? body.voiceId : (defaultVoiceId ?? (await firstVoice(apiKey).catch(() => undefined)));
  if (!voiceId) return Response.json({ error: "The ElevenLabs account has no voices." }, { status: 502 });
  const upstream = await speakWithElevenLabs(apiKey, model, voiceId, text).catch(() => undefined);
  if (!upstream?.ok || !upstream.body) return Response.json({ error: upstream ? `ElevenLabs answered ${upstream.status}.` : "ElevenLabs could not be reached." }, { status: 502 });
  return new Response(upstream.body, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
}
