// Pure DSP helpers shared by the audio worklets and the main thread. No Web Audio types here,
// so everything is unit-testable in Node.

export const CAPTURE_RATE = 16000;
/** 20 ms at 16 kHz. */
export const FRAME_SAMPLES = 320;

/**
 * Streaming linear-interpolation resampler with a one-pole low-pass ahead of decimation.
 * Good enough for speech going to STT; not for music.
 */
export class Resampler {
  private readonly step: number;
  private pos = 0; // fractional read position into the virtual input stream, relative to `prev`
  private prev = 0;
  private lp = 0;
  private readonly alpha: number;

  constructor(
    readonly inRate: number,
    readonly outRate: number,
  ) {
    this.step = inRate / outRate;
    // Cutoff a little under the output Nyquist when decimating; pass-through otherwise.
    const cutoff = outRate < inRate ? outRate * 0.45 : inRate / 2;
    const rc = 1 / (2 * Math.PI * cutoff);
    const dt = 1 / inRate;
    this.alpha = outRate < inRate ? dt / (rc + dt) : 1;
  }

  process(input: Float32Array): Float32Array {
    if (this.inRate === this.outRate) return input.slice();
    const out: number[] = [];
    // Low-pass in place into a working buffer that starts with the previous sample.
    const x = new Float32Array(input.length + 1);
    x[0] = this.prev;
    for (let i = 0; i < input.length; i++) {
      this.lp += this.alpha * (input[i] - this.lp);
      x[i + 1] = this.lp;
    }
    let pos = this.pos;
    while (pos + 1 < x.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      out.push(x[i] + (x[i + 1] - x[i]) * frac);
      pos += this.step;
    }
    this.pos = pos - input.length;
    this.prev = x[x.length - 1];
    return Float32Array.from(out);
  }
}

/** Collects float samples into fixed-size PCM16 frames. */
export class Framer {
  private buf: Int16Array;
  private fill = 0;

  constructor(readonly size: number = FRAME_SAMPLES) {
    this.buf = new Int16Array(size);
  }

  push(samples: Float32Array): Int16Array[] {
    const frames: Int16Array[] = [];
    for (let i = 0; i < samples.length; i++) {
      this.buf[this.fill++] = floatToInt16(samples[i]);
      if (this.fill === this.size) {
        frames.push(this.buf);
        this.buf = new Int16Array(this.size);
        this.fill = 0;
      }
    }
    return frames;
  }
}

export function floatToInt16(v: number): number {
  const c = Math.max(-1, Math.min(1, v));
  return c < 0 ? Math.round(c * 0x8000) : Math.round(c * 0x7fff);
}

export function int16ToFloat(src: Int16Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] / 0x8000;
  return out;
}

/** RMS level in dBFS of a PCM16 frame; -Infinity for digital silence. */
export function rmsDbfs(frame: Int16Array): number {
  if (frame.length === 0) return -Infinity;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i] / 0x8000;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / frame.length);
  return rms === 0 ? -Infinity : 20 * Math.log10(rms);
}

export function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // PCM16 little-endian; every platform we target is little-endian.
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
}

/** Single-producer, single-consumer float ring buffer used by the playback worklet (jitter buffer). */
export class RingBuffer {
  private readonly data: Float32Array;
  private readIdx = 0;
  private writeIdx = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    this.data = new Float32Array(capacity);
  }

  get length(): number {
    return this.count;
  }

  /** Writes as much as fits; returns the number of samples dropped (overflow). */
  write(samples: Float32Array): number {
    let dropped = 0;
    for (let i = 0; i < samples.length; i++) {
      if (this.count === this.capacity) {
        dropped = samples.length - i;
        break;
      }
      this.data[this.writeIdx] = samples[i];
      this.writeIdx = (this.writeIdx + 1) % this.capacity;
      this.count++;
    }
    return dropped;
  }

  /** Reads up to out.length samples into out; returns how many were read. */
  read(out: Float32Array): number {
    const n = Math.min(out.length, this.count);
    for (let i = 0; i < n; i++) {
      out[i] = this.data[this.readIdx];
      this.readIdx = (this.readIdx + 1) % this.capacity;
    }
    this.count -= n;
    return n;
  }

  clear(): void {
    this.readIdx = this.writeIdx = this.count = 0;
  }
}

/**
 * The OutputTap: finds the first audible sample of interpreted output, once per arm().
 * Only interpreted audio passes through the playback path, so the deny tone (which goes
 * straight to the destination) can never trip it.
 */
export class OutputTap {
  private armed = false;

  /** threshold: absolute sample amplitude, default ~ -40 dBFS. */
  constructor(readonly threshold = 0.01) {}

  arm(): void {
    this.armed = true;
  }

  get isArmed(): boolean {
    return this.armed;
  }

  /** Returns the index of the first audible sample in the first n samples, or -1. Disarms on a hit. */
  scan(samples: Float32Array, n = samples.length): number {
    if (!this.armed) return -1;
    for (let i = 0; i < n; i++) {
      if (Math.abs(samples[i]) >= this.threshold) {
        this.armed = false;
        return i;
      }
    }
    return -1;
  }
}
