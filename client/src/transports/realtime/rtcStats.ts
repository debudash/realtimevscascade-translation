// Realtime playback health from WebRTC getStats(). The browser owns the jitter buffer, so its
// depth over time is not observable, but the inbound-rtp audio counters give the average buffer
// delay and how much audio was concealed (synthesized to cover gaps) over an interval.
// Spec: https://www.w3.org/TR/webrtc-stats/#inboundrtpstats-dict*

export interface InboundAudioCounters {
  /** Sum of each emitted sample's time in the jitter buffer, seconds. */
  jitterBufferDelay: number;
  jitterBufferEmittedCount: number;
  concealedSamples: number;
  totalSamplesReceived: number;
  packetsLost: number;
}

export interface PlaybackStats {
  /** Average jitter-buffer delay of the audio played in the interval, ms. */
  jitterBufferMs: number;
  /** Share of samples that were concealment rather than received audio, percent. */
  concealedPct: number;
  packetsLost: number;
}

export function readInboundAudio(report: RTCStatsReport): InboundAudioCounters | null {
  for (const s of report.values() as Iterable<Record<string, unknown>>) {
    if (s.type !== "inbound-rtp" || s.kind !== "audio") continue;
    const n = (k: string) => (typeof s[k] === "number" ? (s[k] as number) : 0);
    return {
      jitterBufferDelay: n("jitterBufferDelay"),
      jitterBufferEmittedCount: n("jitterBufferEmittedCount"),
      concealedSamples: n("concealedSamples"),
      totalSamplesReceived: n("totalSamplesReceived"),
      packetsLost: n("packetsLost"),
    };
  }
  return null;
}

/** Stats for the audio played between two snapshots; null if nothing was played. */
export function playbackStatsBetween(a: InboundAudioCounters, b: InboundAudioCounters): PlaybackStats | null {
  // Counters restart with a new peer connection (reconnect): treat b as a fresh start.
  const base = b.jitterBufferEmittedCount < a.jitterBufferEmittedCount ? null : a;
  const d = (k: keyof InboundAudioCounters) => b[k] - (base ? base[k] : 0);
  const emitted = d("jitterBufferEmittedCount");
  if (emitted <= 0) return null;
  const total = d("totalSamplesReceived");
  return {
    jitterBufferMs: round1((d("jitterBufferDelay") / emitted) * 1000),
    concealedPct: total > 0 ? round1((d("concealedSamples") / total) * 100) : 0,
    packetsLost: Math.max(0, d("packetsLost")),
  };
}

const round1 = (x: number) => Math.round(x * 10) / 10;
