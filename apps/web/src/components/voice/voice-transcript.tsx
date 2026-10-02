"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useVoice } from "./voice-provider";

const FOLD_AFTER_MS = 10_000;

/** One line on what voice is doing, for the strip under the header. */
function line(voice: ReturnType<typeof useVoice>): { label: string; text?: string } | undefined {
  switch (voice.state) {
    case "starting":
      return { label: "Starting" };
    case "listening":
      return { label: voice.mode === "dictation" ? "Dictating" : "Listening", ...(voice.interim ? { text: voice.interim } : {}) };
    case "downloadable":
      return { label: `${voice.languageName} can be installed for offline use. Press the download button in the header.` };
    case "downloading":
      return { label: `${voice.languageName} is downloading for offline use` };
    case "blocked":
    case "unavailable":
      return voice.error ? { label: voice.error } : undefined;
    default:
      if (voice.error) return { label: voice.error };
      return voice.heard ? { label: "Heard:", text: voice.heard.text } : undefined;
  }
}

/**
 * The transcript strip under the header: what is heard while listening, the last transcript, and
 * problems in words. It folds away ten seconds after it last changed while idle. A hidden live
 * region announces Listening and Stopped.
 */
export function VoiceTranscript() {
  const voice = useVoice();
  const current = voice.supported ? line(voice) : undefined;
  const key = current ? `${voice.state}:${current.label}:${current.text ?? ""}` : "";
  const [folded, setFolded] = useState<string>();
  const idle = voice.state === "idle" || voice.state === "blocked" || voice.state === "unavailable";
  useEffect(() => {
    if (!key || !idle) return;
    const timer = setTimeout(() => setFolded(key), FOLD_AFTER_MS);
    return () => clearTimeout(timer);
  }, [key, idle]);
  const shown = current && folded !== key ? current : undefined;

  const listening = voice.state === "listening";
  const wasListening = useRef(false);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (listening && !wasListening.current) setAnnouncement("Listening");
    if (!listening && wasListening.current) setAnnouncement("Stopped");
    wasListening.current = listening;
  }, [listening]);

  return (
    <>
      <span data-testid="voice-live" aria-live="polite" className="sr-only">
        {announcement}
      </span>
      <div role="status" aria-label="Voice" className="border-t bg-subtle empty:hidden">
        {shown && (
          <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-1.5 text-[13px] sm:px-6">
            <span className="font-medium">{shown.label}</span>{" "}
            {shown.text && <span className="min-w-0 flex-1 truncate text-muted-foreground">{shown.text}</span>}
            {listening && (
              <Button type="button" size="sm" variant="outline" className="ml-auto h-7" onClick={voice.abort}>
                Stop
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
