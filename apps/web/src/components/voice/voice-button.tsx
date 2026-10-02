"use client";

import { DownloadIcon, MicIcon, MicOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useVoice } from "./voice-provider";

/**
 * The header's microphone: Listen and Stop listening, or the offer to install the language for
 * offline use. Clicking it keeps focus where it was, so listening from a text field dictates into it.
 */
export function VoiceButton() {
  const voice = useVoice();
  if (!voice.supported) return null;
  const active = voice.state === "listening" || voice.state === "starting";
  if (voice.state === "downloadable") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="relative text-attention after:absolute after:-inset-1.5"
        aria-label={`Install ${voice.languageName} for offline use`}
        title={`Install ${voice.languageName} for offline use`}
        onClick={() => void voice.install()}
      >
        <DownloadIcon />
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      // A 44 px target around the header-sized icon.
      className={cn("relative text-muted-foreground after:absolute after:-inset-1.5", active && "bg-attention-bg text-attention motion-safe:animate-pulse")}
      aria-label={active ? "Stop listening" : "Listen"}
      aria-pressed={active}
      title={active ? "Stop listening (V or Escape)" : "Listen (V)"}
      onMouseDown={(e) => e.preventDefault()}
      onClick={voice.toggle}
    >
      {voice.state === "blocked" ? <MicOffIcon /> : <MicIcon />}
    </Button>
  );
}
