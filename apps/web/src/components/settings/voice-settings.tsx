"use client";

import { useState, type ReactNode } from "react";
import { MicOffIcon, PlayIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { elevenLabsPlayer } from "@/lib/voice/elevenlabs-player";
import { readVoicePrefs, writeVoicePrefs, type VoicePrefs } from "@/lib/voice/prefs";
import { useVoiceSupport, type VoiceSupport } from "@/lib/voice/support";
import { cn } from "@/lib/utils";

const LANGUAGES = [
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "sv-SE", label: "Swedish" },
  { value: "de-DE", label: "German" },
  { value: "fr-FR", label: "French" },
  { value: "es-ES", label: "Spanish" },
];
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const rateLabel = (rate: number) => (rate === 1 ? "1x, normal" : `${rate}x`);

/** One setting: its title and what it does on the left, the control on the right. Without an id the title labels nothing. */
function Row({ id, title, description, disabled, children }: { id?: string; title: string; description: ReactNode; disabled?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-t py-3.5">
      <div className={cn("flex max-w-[460px] flex-col gap-0.5", disabled && "opacity-55")}>
        {id ? <Label htmlFor={id}>{title}</Label> : <span className="text-sm font-medium">{title}</span>}
        <span className="text-xs leading-normal text-muted-foreground">{description}</span>
      </div>
      {children}
    </div>
  );
}

/** A group's heading: Listening or Speaking. */
function Group({ children, first }: { children: ReactNode; first?: boolean }) {
  return <p className={cn("pt-[18px] pb-0.5 text-[11px] font-medium tracking-[0.05em] text-muted-foreground uppercase", first ? "pt-0" : "border-t")}>{children}</p>;
}

const TEST_SENTENCE = "This is how handoff sounds.";

/** What the settings page read from ElevenLabs on the server: the account's voices, or why it could not. */
export type ElevenLabsVoices = { voices: { id: string; name: string }[] } | { error: string };

/** The ElevenLabs voice: the account's voices, which the server read with the key, or why it could not. */
function ElevenLabsVoice({ list, value, onChange }: { list: ElevenLabsVoices; value: string | null; onChange: (id: string | null) => void }) {
  const voices = "voices" in list ? list.voices : undefined;
  const problem = "error" in list ? list.error : undefined;
  return (
    <Row id="voice-elevenlabs" title="ElevenLabs voice" description={problem ?? "The voices of your ElevenLabs account. Default is the dashboard's choice."} disabled={Boolean(problem)}>
      <NativeSelect id="voice-elevenlabs" className="w-60" value={value ?? ""} disabled={!voices} onChange={(e) => onChange(e.target.value || null)}>
        <NativeSelectOption value="">Default voice</NativeSelectOption>
        {voices?.map((v) => (
          <NativeSelectOption key={v.id} value={v.id}>
            {v.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Row>
  );
}

/**
 * How this browser listens and how the dashboard speaks: the language, whether audio may go to Google's
 * recognition service, which replies and notifications are spoken, and the ElevenLabs voice and rate.
 * Kept in this browser.
 */
export function VoiceSettings({ support: given, elevenLabs }: { support?: VoiceSupport; elevenLabs?: ElevenLabsVoices }) {
  const browser = useVoiceSupport();
  const support = given ?? browser;
  const [prefs, setPrefs] = useState<VoicePrefs>(readVoicePrefs);
  const update = (patch: Partial<VoicePrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    writeVoicePrefs(next);
  };
  const test = () => void elevenLabsPlayer().play(TEST_SENTENCE, prefs, { end: () => {}, error: () => {} });
  const canSpeak = Boolean(elevenLabs);
  const listens = Boolean(support.recognition);
  return (
    <div className="flex flex-col text-sm [&_[data-group]+div]:border-t-0">
      {!listens && (
        <p role="note" className="mb-[18px] flex items-start gap-2 rounded-md border bg-subtle px-3 py-2 text-xs leading-normal text-muted-foreground [&_svg]:mt-px [&_svg]:size-3.5">
          <MicOffIcon aria-hidden />
          This browser has no speech recognition, so the microphone button is hidden. Replies and notifications can still be read aloud.
        </p>
      )}
      {listens && !support.onDeviceCheck && (
        <p className="mb-3 text-xs text-muted-foreground">This browser cannot check for on-device recognition, so listening needs server-based recognition.</p>
      )}
      <Group first>Listening</Group>
      <div data-group />
      <Row id="voice-lang" title="Language" description="The language you speak." disabled={!listens}>
        <NativeSelect id="voice-lang" value={prefs.lang} disabled={!listens} onChange={(e) => update({ lang: e.target.value })}>
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
        description="Sends your voice to your browser's speech service (Google, in Chrome) for better accuracy. Off: speech is recognized on this computer, after a one-time download of the language."
        disabled={!listens}
      >
        <Switch id="voice-server" checked={prefs.allowServerRecognition} disabled={!listens} onCheckedChange={(on) => update({ allowServerRecognition: on })} />
      </Row>
      <Group>Speaking</Group>
      <div data-group />
      <p className="pt-3 text-xs leading-normal text-muted-foreground">
        {canSpeak
          ? "The dashboard speaks with ElevenLabs: the text read aloud goes to ElevenLabs."
          : "Add ELEVENLABS_API_KEY to the dashboard's environment and restart it. The dashboard speaks with ElevenLabs, so the text read aloud goes to ElevenLabs."}
      </p>
      <Row id="voice-replies" title="Speak replies" description="Read the assistant's replies aloud, with a Stop button while it speaks. It never listens while speaking." disabled={!canSpeak}>
        <Switch id="voice-replies" checked={prefs.speakReplies} disabled={!canSpeak} onCheckedChange={(on) => update({ speakReplies: on })} />
      </Row>
      <Row id="voice-notifications" title="Speak notifications" description="Read new questions, failed runs and reviews aloud as they arrive." disabled={!canSpeak}>
        <Switch id="voice-notifications" checked={prefs.speakNotifications} disabled={!canSpeak} onCheckedChange={(on) => update({ speakNotifications: on })} />
      </Row>
      <div className="-mt-1 flex items-center gap-2 pb-3 pl-5 text-[13px]">
        <Checkbox
          id="voice-finished"
          checked={prefs.speakFinished}
          disabled={!canSpeak || !prefs.speakNotifications}
          onCheckedChange={(on) => update({ speakFinished: on === true })}
        />
        <Label htmlFor="voice-finished" className="font-normal">
          Also finished and merged runs
        </Label>
      </div>
      {elevenLabs && <ElevenLabsVoice list={elevenLabs} value={prefs.elevenLabsVoiceId} onChange={(id) => update({ elevenLabsVoiceId: id })} />}
      <Row id="voice-rate" title="Rate" description="How fast replies and notifications are read." disabled={!canSpeak}>
        <NativeSelect id="voice-rate" value={String(prefs.rate)} disabled={!canSpeak} onChange={(e) => update({ rate: Number(e.target.value) })}>
          {RATES.map((r) => (
            <NativeSelectOption key={r} value={String(r)}>
              {rateLabel(r)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      <Row title="Test" description="Reads one sentence with this voice and rate." disabled={!canSpeak}>
        <Button type="button" size="sm" variant="outline" disabled={!canSpeak} onClick={test}>
          <PlayIcon data-icon="inline-start" />
          Test voice
        </Button>
      </Row>
    </div>
  );
}
