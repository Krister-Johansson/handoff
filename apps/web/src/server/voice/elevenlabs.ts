const API = "https://api.elevenlabs.io/v1";
const DEFAULT_MODEL = "eleven_flash_v2_5";
/** A sentence is short; anything longer is refused before it costs characters. */
export const MAX_SPEAK_CHARS = 1000;

export const NO_KEY = "Add ELEVENLABS_API_KEY to the dashboard's environment and restart it.";

/** ElevenLabs from the dashboard's environment; the key never leaves the server. */
export function elevenLabsConfig(env: Record<string, string | undefined> = process.env) {
  return {
    apiKey: env.ELEVENLABS_API_KEY || undefined,
    model: env.HANDOFF_ELEVENLABS_MODEL || DEFAULT_MODEL,
    defaultVoiceId: env.HANDOFF_ELEVENLABS_VOICE_ID || undefined,
  };
}

/** One sentence as MP3 from ElevenLabs' streaming text to speech. */
export async function speakWithElevenLabs(apiKey: string, model: string, voiceId: string, text: string): Promise<Response> {
  return fetch(`${API}/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: model }),
  });
}

/** The account's voices, by name. */
export async function listElevenLabsVoices(apiKey: string): Promise<{ id: string; name: string }[]> {
  const response = await fetch(`${API}/voices`, { headers: { "xi-api-key": apiKey } });
  if (!response.ok) throw new Error(`ElevenLabs answered ${response.status}.`);
  const body = (await response.json()) as { voices?: { voice_id: string; name: string }[] };
  return (body.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name })).toSorted((a, b) => a.name.localeCompare(b.name));
}

let first: { apiKey: string; voiceId: string | undefined } | undefined;

/** The account's first voice by name, the default when none is chosen; remembered per key. */
export async function firstVoice(apiKey: string): Promise<string | undefined> {
  if (first?.apiKey === apiKey && first.voiceId) return first.voiceId;
  const voiceId = (await listElevenLabsVoices(apiKey))[0]?.id;
  first = { apiKey, voiceId };
  return voiceId;
}
