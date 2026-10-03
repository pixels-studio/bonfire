let audio: AudioContext | undefined;

/** Two soft rising notes, synthesized so there is no audio file to ship. */
const CHIME = [
  { frequency: 880, delay: 0 },
  { frequency: 1318.5, delay: 0.12 },
];
const NOTE_SECONDS = 0.6;
const VOLUME = 0.12;

/** Plays the sound for a finished turn. */
export function playCompletionSound() {
  audio ??= new AudioContext();
  const start = audio.currentTime;
  const output = audio.createGain();
  output.gain.value = VOLUME;
  output.connect(audio.destination);
  for (const { frequency, delay } of CHIME) {
    const oscillator = audio.createOscillator();
    const envelope = audio.createGain();
    oscillator.frequency.value = frequency;
    // A quick attack and an exponential fade, like a struck bell.
    envelope.gain.setValueAtTime(0, start + delay);
    envelope.gain.linearRampToValueAtTime(1, start + delay + 0.01);
    envelope.gain.exponentialRampToValueAtTime(
      0.001,
      start + delay + NOTE_SECONDS,
    );
    oscillator.connect(envelope).connect(output);
    oscillator.start(start + delay);
    oscillator.stop(start + delay + NOTE_SECONDS);
  }
}
