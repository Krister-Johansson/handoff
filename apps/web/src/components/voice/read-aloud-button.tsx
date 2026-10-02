"use client";

import { SquareIcon, Volume2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReadAloud } from "@/lib/voice/use-read-aloud";
import { useVoice } from "./voice-provider";

/**
 * Reads a page's long content aloud, sentence by sentence, and stops it again. The strip under the
 * header shows how far it got; Escape stops too. Absent where the browser cannot speak.
 */
export function ReadAloudButton({ title, text }: { title: string; text: string }) {
  const voice = useVoice();
  useReadAloud({ title, text });
  if (!voice.canSpeak || !text.trim()) return null;
  const reading = voice.speech.speaking && voice.speech.priority === "read" && voice.speech.title === title;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => (reading ? voice.stopSpeaking() : voice.speak(text, { priority: "read", title }))}
    >
      {reading ? <SquareIcon data-icon="inline-start" /> : <Volume2Icon data-icon="inline-start" />}
      {reading ? "Stop reading" : "Read aloud"}
    </Button>
  );
}
