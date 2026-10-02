"use client";

import { useEffect } from "react";
import { useVoice, type Readable } from "@/components/voice/voice-provider";

/** Offers the page's content to read aloud ("read this" and the Read aloud button) while the page is open. */
export function useReadAloud(content: Readable) {
  const { registerReadable } = useVoice();
  const { title, text } = content;
  useEffect(() => registerReadable({ title, text }), [registerReadable, title, text]);
}
