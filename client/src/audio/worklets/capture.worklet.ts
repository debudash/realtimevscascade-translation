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
      const frames = this.framer.push(this.resampler.process(channel));
      const quantumEnd = currentTime + channel.length / sampleRate;
      for (const pcm of frames) {
        this.port.postMessage({ pcm, ctxEnd: quantumEnd }, [pcm.buffer]);
      }
    }
    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
