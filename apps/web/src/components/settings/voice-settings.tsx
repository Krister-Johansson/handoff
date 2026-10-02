"use client";

import { useCallback, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { readVoicePrefs, writeVoicePrefs, type VoicePrefs } from "@/lib/voice/prefs";
import { detectVoiceSupport, type VoiceSupport } from "@/lib/voice/support";

const LANGUAGES = [
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "sv-SE", label: "Swedish" },
  { value: "de-DE", label: "German" },
  { value: "fr-FR", label: "French" },
  { value: "es-ES", label: "Spanish" },
];
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

function Row({ id, title, description, children }: { id: string; title: string; description: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t py-3.5 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id}>{title}</Label>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      {children}
    </div>
  );
}

const NO_VOICES: SpeechSynthesisVoice[] = [];
// getVoices() returns a new array on every call; keep one per synth until voiceschanged.
const voiceCache = new WeakMap<SpeechSynthesis, SpeechSynthesisVoice[]>();

/** The browser's voices, kept current: Chrome fills the list after page load and fires voiceschanged. */
function useVoices(synth: SpeechSynthesis | undefined) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!synth) return () => {};
      const changed = () => {
        voiceCache.delete(synth);
        onChange();
      };
      synth.addEventListener("voiceschanged", changed);
      return () => synth.removeEventListener("voiceschanged", changed);
    },
    [synth],
  );
  const snapshot = () => {
    if (!synth) return NO_VOICES;
    const cached = voiceCache.get(synth);
    if (cached) return cached;
    const voices = synth.getVoices();
    // An empty list is not cached: Chrome may fill it before this component listens for voiceschanged.
    if (!voices.length) return NO_VOICES;
    voiceCache.set(synth, voices);
    return voices;
  };
  return useSyncExternalStore(subscribe, snapshot, () => NO_VOICES);
}

const NO_SUPPORT: VoiceSupport = { onDeviceCheck: false };
let detected: VoiceSupport | undefined;
const noSubscribe = () => () => {};
/** This browser's voice support, detected once; nothing on the server. */
const useDetectedSupport = () =>
  useSyncExternalStore(
    noSubscribe,
    () => (detected ??= detectVoiceSupport(globalThis as never)),
    () => NO_SUPPORT,
  );

/**
 * How this browser listens and speaks: the language, whether audio may go to Google's recognition
 * service, which replies and notifications are spoken, and the voice. Kept in this browser.
 */
export function VoiceSettings({ support: given }: { support?: VoiceSupport }) {
  const browser = useDetectedSupport();
  const support = given ?? browser;
  const [prefs, setPrefs] = useState<VoicePrefs>(readVoicePrefs);
  const voices = useVoices(support.synth);
  const update = (patch: Partial<VoicePrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    writeVoicePrefs(next);
  };
  const listed = voices
    .filter((v) => v.localService || prefs.allowRemoteVoices)
    .toSorted((a, b) => Number(b.localService) - Number(a.localService) || Number(b.lang === prefs.lang) - Number(a.lang === prefs.lang));
  const test = () => {
    if (!support.synth) return;
    const utterance = new SpeechSynthesisUtterance("This is how handoff sounds.");
    utterance.voice = voices.find((v) => v.voiceURI === prefs.voiceURI) ?? null;
    utterance.lang = prefs.lang;
    utterance.rate = prefs.rate;
    support.synth.cancel();
    support.synth.speak(utterance);
  };
  const canSpeak = Boolean(support.synth);
  return (
    <div className="flex flex-col text-sm">
      {!support.recognition ? (
        <p className="pb-3 text-xs text-muted-foreground">Speech recognition is not available in this browser. Chrome on Windows, macOS or Linux supports it.</p>
      ) : (
        !support.onDeviceCheck && (
          <p className="pb-3 text-xs text-muted-foreground">This browser cannot check for on-device recognition, so listening needs server-based recognition.</p>
        )
      )}
      <Row id="voice-lang" title="Language" description="What you speak, and the language voices are picked for.">
        <NativeSelect id="voice-lang" value={prefs.lang} onChange={(e) => update({ lang: e.target.value })}>
          {LANGUAGES.map((l) => (
            <NativeSelectOption key={l.value} value={l.value}>
              {l.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      <Row
        id="voice-server"
        title="Server-based recognition"
        description="When this language has no on-device pack, send audio to Google's speech service. Off keeps audio on this machine."
      >
        <Switch id="voice-server" checked={prefs.allowServerRecognition} disabled={!support.recognition} onCheckedChange={(on) => update({ allowServerRecognition: on })} />
      </Row>
      {!canSpeak && <p className="border-t py-3 text-xs text-muted-foreground">This browser cannot speak, so the speaking settings are off.</p>}
      <Row id="voice-replies" title="Speak replies" description="Read each finished assistant reply aloud. The text stays on screen.">
        <Switch id="voice-replies" checked={prefs.speakReplies} disabled={!canSpeak} onCheckedChange={(on) => update({ speakReplies: on })} />
      </Row>
      <Row id="voice-notifications" title="Speak notifications" description="Say new questions, permission requests, pull requests ready to merge and failed runs.">
        <Switch id="voice-notifications" checked={prefs.speakNotifications} disabled={!canSpeak} onCheckedChange={(on) => update({ speakNotifications: on })} />
      </Row>
      <Row id="voice-finished" title="Also finished and merged runs" description="Say those too, not only what needs you.">
        <Switch id="voice-finished" checked={prefs.speakFinished} disabled={!canSpeak || !prefs.speakNotifications} onCheckedChange={(on) => update({ speakFinished: on })} />
      </Row>
      <Row id="voice-voice" title="Voice" description="Automatic picks a voice on this machine for the language.">
        <NativeSelect id="voice-voice" value={prefs.voiceURI ?? ""} disabled={!canSpeak} onChange={(e) => update({ voiceURI: e.target.value || null })}>
          <NativeSelectOption value="">Automatic</NativeSelectOption>
          {listed.map((v) => (
            <NativeSelectOption key={v.voiceURI} value={v.voiceURI}>
              {`${v.name} (${v.lang}${v.localService ? "" : ", remote"})`}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      <Row id="voice-remote" title="Remote voices" description="List voices that send the text to their vendor to synthesize.">
        <Switch id="voice-remote" checked={prefs.allowRemoteVoices} disabled={!canSpeak} onCheckedChange={(on) => update({ allowRemoteVoices: on })} />
      </Row>
      <Row id="voice-rate" title="Rate" description="How fast the voice speaks.">
        <NativeSelect id="voice-rate" value={String(prefs.rate)} disabled={!canSpeak} onChange={(e) => update({ rate: Number(e.target.value) })}>
          {RATES.map((r) => (
            <NativeSelectOption key={r} value={String(r)}>
              {`${r}×`}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      <div className="flex items-center justify-between gap-4 border-t pt-3.5">
        <span className="text-xs text-muted-foreground">Speaking and a screen reader can talk over each other. Both are off by default.</span>
        <Button type="button" size="sm" variant="outline" disabled={!canSpeak} onClick={test}>
          Test voice
        </Button>
      </div>
    </div>
  );
}
