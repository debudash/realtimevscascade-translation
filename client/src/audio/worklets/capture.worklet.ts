/// <reference path="./worklet-env.d.ts" />
// CaptureWorklet: context-rate float input -> PCM16 16 kHz mono, 20 ms frames.
// Posts { pcm: Int16Array(320), ctxEnd } where ctxEnd is the context time of the frame's end.
import { CAPTURE_RATE, FRAME_SAMPLES, Framer, Resampler } from "../dsp";

class CaptureProcessor extends AudioWorkletProcessor {
  private readonly resampler = new Resampler(sampleRate, CAPTURE_RATE);
  private readonly framer = new Framer(FRAME_SAMPLES);

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel) {
      const resampled = this.resampler.process(channel);
      const frames = this.framer.push(resampled);
      const quantumS = channel.length / sampleRate;
      frames.forEach((pcm, i) => {
        // Interpolate where in this render quantum the frame's last sample falls.
        const ctxEnd = currentTime + (this.framer.lastEndOffsets[i] / Math.max(1, resampled.length)) * quantumS;
        this.port.postMessage({ pcm, ctxEnd }, [pcm.buffer]);
      });
    }
    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
