import { rmsDbfs } from "./dsp";

export interface EnergyDetectorOptions {
  /** Frames at or above this RMS level count as voiced. */
  thresholdDbfs: number;
  /** Consecutive voiced frames needed to declare speech start (debounces clicks). */
  startFrames: number;
  /** Unvoiced time after the last voiced frame before a speech_end event fires. */
  hangoverMs: number;
}

/**
 * Tuned on the synthetic clips (clean TTS speech, ~-20 dBFS) and a laptop mic with
 * browser noise suppression on (floor ~-60 dBFS): -45 dBFS sits well between them.
 */
export const DEFAULT_ENERGY_OPTIONS: EnergyDetectorOptions = {
  thresholdDbfs: -45,
  startFrames: 2,
  hangoverMs: 300,
};

export type EnergyEvent =
  | { type: "speech_start"; t: number }
  | { type: "speech_end"; t: number };

/**
 * Client-side voice activity on 20 ms frames. T0 (acoustic speech end) is the end time of
 * the last voiced frame, read with lastVoicedEnd at release; it is not the release time.
 */
export class EnergyDetector {
  private voicedRun = 0;
  private inSpeech = false;
  private lastVoiced: number | null = null;
  private firstSpeech: number | null = null;
  level = -Infinity;

  constructor(readonly opts: EnergyDetectorOptions = DEFAULT_ENERGY_OPTIONS) {}

  reset(): void {
    this.voicedRun = 0;
    this.inSpeech = false;
    this.lastVoiced = null;
    this.firstSpeech = null;
    this.level = -Infinity;
  }

  /** The end time of the last voiced frame seen since reset (T0 candidate). */
  get lastVoicedEnd(): number | null {
    return this.lastVoiced;
  }

  get speechStart(): number | null {
    return this.firstSpeech;
  }

  /**
   * @param frame PCM16 frame
   * @param startMs browser-clock time of the frame's first sample
   * @param durationMs frame duration
   */
  push(frame: Int16Array, startMs: number, durationMs: number): EnergyEvent[] {
    const events: EnergyEvent[] = [];
    const end = startMs + durationMs;
    this.level = rmsDbfs(frame);
    const voiced = this.level >= this.opts.thresholdDbfs;

    if (voiced) {
      this.voicedRun++;
      if (!this.inSpeech && this.voicedRun >= this.opts.startFrames) {
        this.inSpeech = true;
        // Speech started at the first frame of the run.
        const t = startMs - (this.opts.startFrames - 1) * durationMs;
        if (this.firstSpeech === null) this.firstSpeech = t;
        events.push({ type: "speech_start", t });
      }
      if (this.inSpeech) this.lastVoiced = end;
    } else {
      this.voicedRun = 0;
      if (this.inSpeech && this.lastVoiced !== null && end - this.lastVoiced >= this.opts.hangoverMs) {
        this.inSpeech = false;
        events.push({ type: "speech_end", t: this.lastVoiced });
      }
    }
    return events;
  }
}
