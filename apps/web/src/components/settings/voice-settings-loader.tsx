"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/** The voice settings read this browser's speech support, voices and storage, so they render in the browser only. */
export const VoiceSettingsLoader = dynamic(() => import("./voice-settings").then((m) => m.VoiceSettings), {
  ssr: false,
  loading: () => <Skeleton className="h-72 max-w-md" />,
});
