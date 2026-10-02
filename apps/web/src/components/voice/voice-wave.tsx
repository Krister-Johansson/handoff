const BARS = [
  { height: 6, delay: "-0.2s" },
  { height: 12, delay: "-0.5s" },
  { height: 9, delay: "-0.1s" },
  { height: 5, delay: "-0.7s" },
];

/** Four bars that move while the microphone listens or the dashboard speaks; still with reduced motion. */
export function VoiceWave() {
  return (
    <span aria-hidden className="inline-flex h-3.5 w-4 flex-none items-center justify-center gap-0.5">
      {BARS.map((bar) => (
        <b
          key={bar.delay}
          className="block w-0.5 animate-voice-wave rounded-full bg-active-dot motion-reduce:animate-none"
          style={{ height: bar.height, animationDelay: bar.delay }}
        />
      ))}
    </span>
  );
}
