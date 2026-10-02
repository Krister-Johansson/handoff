import type { RecognitionCtor, VoiceSupport } from "@/lib/voice/support";
import { FakeSpeechRecognition } from "@/lib/voice/testing/fake-speech-recognition";
import { VoiceButton } from "../voice-button";
import { VoiceHotkeys } from "../voice-hotkeys";
import { VoiceProvider } from "../voice-provider";
import { VoiceTranscript } from "../voice-transcript";

const withRecognition: VoiceSupport = { recognition: FakeSpeechRecognition as unknown as RecognitionCtor, onDeviceCheck: true };

/** The header button, the strip and the hotkeys around a page with a text field, as the layout mounts them. */
export function VoiceTestApp({ support = withRecognition, speaking = false }: { support?: VoiceSupport; speaking?: boolean }) {
  return (
    <VoiceProvider support={support} speaker={{ isSpeaking: () => speaking }}>
      <VoiceButton />
      <VoiceTranscript />
      <VoiceHotkeys />
      <main>
        <h1>Inbox</h1>
        <label htmlFor="note">Note</label>
        <textarea id="note" />
      </main>
    </VoiceProvider>
  );
}
