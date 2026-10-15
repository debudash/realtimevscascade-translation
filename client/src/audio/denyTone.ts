/** The minimal slice of BaseAudioContext the deny tone needs (lets tests pass a fake). */
export interface ToneContext {
  readonly currentTime: number;
  readonly destination: AudioNode;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
}

export const DENY_TONE_MS = 230;
const NOTES_HZ = [660, 440]; // a short falling two-note "busy"
const GAIN = 0.06; // low

/**
 * Floor-deny feedback tone (~230 ms, two notes, low gain), generated with Web Audio.
 * Routed straight to ctx.destination, never through the playback worklet / OutputTap,
 * so it can never register as first_audible.
 */
export function playDenyTone(ctx: ToneContext): void {
  const noteS = DENY_TONE_MS / 1000 / NOTES_HZ.length;
  const t0 = ctx.currentTime + 0.005;
  NOTES_HZ.forEach((hz, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = t0 + i * noteS;
    osc.type = "sine";
    osc.frequency.setValueAtTime(hz, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(GAIN, start + 0.01);
    gain.gain.setValueAtTime(GAIN, start + noteS - 0.02);
    gain.gain.linearRampToValueAtTime(0, start + noteS);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + noteS + 0.01);
  });
}
