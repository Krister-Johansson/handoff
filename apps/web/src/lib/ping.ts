/** A short two-note chime from the Web Audio API, so the dashboard needs no sound file. */
export function playPing() {
  try {
    const context = new AudioContext();
    const notes = [880, 1320];
    notes.forEach((frequency, i) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + i * 0.12;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.3);
    });
    setTimeout(() => void context.close(), 800);
  } catch {
    // No audio in this browser, or it blocked playback before any interaction.
  }
}
