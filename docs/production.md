# Production notes: known limits and how they would be handled

The workbench is a local measurement tool. This page records the limits
found in evaluation that a production interpreter service would have to
manage, what was measured, and the production approach. It complements
"Path to production" in [`comparison.md`](comparison.md).

## 1. Memory over long sessions

### What was measured

The 5-minute soak per mode (45 turns each,
[`harness/results/report.md`](../harness/results/report.md) section 5)
sampled the browser heap without forcing garbage collection. The post-GC
floor (minimum in the first vs. the last minute) grew:

| Mode | Heap floor, first min -> last min | Growth over 45 turns |
|---|---|---|
| Realtime | 12.6 MB -> 17.5 MB | +4.9 MB |
| Cascade | 12.4 MB -> 16.1 MB | +3.7 MB |

Server memory was not sampled.

### What it means

- **Expected retention explains part of it.** The session keeps every turn
  for the latency table and Export: marks, stage timings, source and target
  text, usage (`MetricsStore` in `client/src/state/metrics.ts`, never
  evicted). "Retry turn" keeps the captured audio of the last 5 turns only
  (`RETRY_KEEP_TURNS` in `client/src/session/controller.ts`).
- **A slow leak is not ruled out.** Five minutes and one run per mode cannot
  separate retained data from leaked objects. The growth was not attributed
  with a heap snapshot.
- **The server side is unmeasured.** Its per-session state is bounded by
  design (bounded channels, per-turn cancellation and disposal, pooled HTTP
  handlers, one cached glossary), but that is a design claim, not a
  measurement.

### How production would manage it

| Layer | Practice |
|---|---|
| Browser session state | Cap what a live call keeps in memory: a fixed window of recent turns on screen, older turns streamed to the server (the control plane's audit record) instead of held in the tab. Release audio buffers and close audio contexts when a call ends. |
| Media plane service | Export runtime metrics per instance with OpenTelemetry (.NET runtime metrics: GC heap size, gen 2 collections, LOH size, working set) next to active stream count, so memory per active stream is a tracked signal. |
| Detection | Alert on the slope of post-GC memory per active stream, not on absolute size. Capture a `dotnet-gcdump` automatically when the slope crosses a threshold. |
| Containment | Container memory limits with graceful drain: an instance near its limit stops taking new calls, finishes current ones, and is recycled. Calls are bounded in length, so recycling between calls is cheap. |
| Prevention in CI | A nightly long soak (for example 60 minutes at realistic concurrency, fake providers so it costs nothing) with a gate on heap-floor slope for the browser and the service, plus per-session lifetime tests that assert session objects are collected after close. |
| Ownership | A memory budget per concurrent stream, set from load tests, reviewed when providers or codecs change. |

### Next step in this repo (not done)

Run the existing soak with fake providers for 30-60 minutes, take heap
snapshots at the start and end, and compare retained object counts against
the number of turn records. That separates retention from a leak at no API
cost.

## 2. Speech synthesis starts per segment, not per phrase

### What the cascade does

Each committed segment is translated, and its text goes to ElevenLabs only
when the translation is complete (`CascadeTurnPipeline.cs`, HTTP streaming
`/stream`). Audio then streams back as it is synthesized. Segments overlap:
while one is being synthesized the next is being translated, and all of it
runs during speech. So the pipeline streams throughout, but within one
segment, TTS waits for the whole translated sentence.

This was a deliberate choice: ElevenLabs recommends HTTP streaming when the
full text is known, which is the case per segment, and a whole sentence
gives the voice its natural prosody.

### What it costs (measured)

From the server stage durations in `harness/results/report.md` (final
segment, p50 / p95):

| Configuration | Translate first token | Translate done | Gap TTS waits for |
|---|---|---|---|
| Cascade segment (OpenAI) | 0.46 / 0.78 s | 0.61 / 0.89 s | about 0.15 s / 0.11 s |
| Cascade clause (OpenAI) | 0.39 / 0.51 s | 0.47 / 0.65 s | about 0.08 s / 0.14 s |
| Cascade DeepL | 0.33 / 0.40 s | 0.33 / 0.40 s | 0 (DeepL returns the whole segment) |

The gap is the difference of the percentiles, so it is approximate. It is
the most that feeding translation tokens into TTS could save on the final
segment. It is small because clinic sentences are short, and every cascade
configuration already meets the < 2 s stretch target at p95 (1.25-1.89 s).

### How production would do it

- **Phrase-level synthesis for long turns.** Use the ElevenLabs WebSocket
  input-streaming API and send translated text at phrase boundaries
  (punctuation or about 8-12 words), with the provider's chunk schedule
  tuned for latency. Keep sentence-level synthesis as the default for short
  turns, where the gain is under 0.2 s and prosody matters more.
- **Gate it on measurement.** Add it as a selectable option next to the
  commit policies, run the same harness, and adopt it only where p95
  improves without a drop in the fluency score.
- **Pair it with a streaming translator.** It helps only when translation
  streams; with DeepL (no streaming API) there is nothing to gain.
