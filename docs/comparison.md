# Realtime vs. Cascade: comparison and recommendation

Every number below comes from [`harness/results/report.md`](../harness/results/report.md), 2026-10-15.
Each clip of 24 synthetic clinic sentences (12 EN→ES, 12 ES→EN) went through the app's capture path
with push-to-talk automated. Runs are pooled per configuration: Realtime 72 turns (3 runs), each
cascade configuration 48 turns (2 runs).

## 1. Latency: mouth-to-ear (speech end T0 → first audible)

| Configuration | p50 | p95 | Target | Release → first audible p50 |
|---|---|---|---|---|
| Realtime (gpt-realtime, WebRTC) | **1.09 s** | 1.46 s | < 1.5 s ✔ (barely) | 0.69 s |
| Cascade · segment (Deepgram → gpt-4.1-nano → ElevenLabs Flash) | 1.43 s | 1.89 s | < 3 s ✔, < 2 s ✔ | 1.01 s |
| Cascade · clause | 1.21 s | 1.44 s | < 2 s ✔ | 0.80 s |
| Cascade · segment with DeepL | 1.15 s | **1.25 s** | < 3 s ✔, < 2 s ✔ | 0.73 s |

- **Realtime is fastest at p50 but the least predictable.** Its p95 per run was 1.06 s, then 1.72 s
  (that run alone would miss the target), then 1.36 s.
  - The client side is constant: release → response start was 0.12 s every run.
  - The swing is inside the vendor: response start → first audio p50 was 0.36 s, 0.69 s and 0.53 s across the three runs.
- **The cascade's time goes to translation.** In the segment configuration, server-measured stage times are:
  - Deepgram final after release: 0.07 s.
  - gpt-4.1-nano first token: 0.46 s (p95 0.78 s).
  - ElevenLabs first byte: 0.14 s.
- **DeepL is faster than streamed gpt-4.1-nano.** It doesn't stream, but its whole-segment answer arrives in 0.33 s, sooner than the LLM's first token. That makes the DeepL cascade nearly as fast as Realtime at p50 and the steadiest configuration measured.
- **Access time** (press → audio accepted) is about 0.02 s for the cascade, and 0 for Realtime, whose WebRTC track is already live.

## 2. Quality

| Configuration | Target WER vs reference (proxy) | Accuracy / Completeness / Fluency (automated judge) | Answered instead of interpreted |
|---|---|---|---|
| Realtime | 0.097 | 4.96 / 4.97 / 4.99 | 0 / 72 |
| Cascade · segment | 0.059 | 4.96 / 5.00 / 5.00 | 0 / 48 |
| Cascade · clause | 0.088 | 4.83 / 4.88 / 4.71 | 0 / 48 |
| Cascade · DeepL | 0.293 | 4.96 / 5.00 / 4.96 | 0 / 48 |

Source WER was 0.000 everywhere: clean synthetic speech. Realtime's figure is from its side
transcription. **Neither architecture ever answered a question instead of interpreting it.**

The judge and WER miss three things that matter in a clinic:

1. **Register.** DeepL used informal *tú* throughout ("¿Te duele cuando respiras…?"). Realtime used *usted*. The OpenAI cascade mixed the two. This explains most of DeepL's higher WER.
2. **Terminology.** Realtime and DeepL rendered "receta" as *recipe*; the OpenAI cascade said *prescription*.
3. **Clause seams.** Committing clauses mid-sentence produced "The child fell down. and hurt his left arm." and "¿Duele? ¿Cuando respira profundamente?", which shows in fluency (4.71).

Both are fixable, and the follow-up measured it ([translation-controls.md](translation-controls.md)):
with a formality setting, a glossary and matching prompt instructions, every Spanish sentence that
addresses the listener came out formal and "receta" became *prescription* in all three pipelines.
DeepL went from 4/18 to 9/9 formal and from 18/28 to 14/14 glossary terms. These baseline numbers
are with the controls off.

## 3. Cost per minute of input speech

| Realtime | Cascade (OpenAI) | Cascade (DeepL) |
|---|---|---|
| **$0.210** | **$0.043** | $0.066 (DeepL rate unverified) |

Usage was logged per turn and priced from `harness/pricing.json`. OpenAI, Deepgram and ElevenLabs
prices were checked against their official pricing pages on 2026-10-15. Two caveats: Deepgram's
streaming rate is a limited-time promotion (list price would add about $0.003/min to the cascade),
and DeepL's API rate could not be confirmed on deepl.com (the Growth plan's overage would add about
$0.0025/min). The cascade is about **4.8× cheaper** (about 4.5× at Deepgram's list price). Realtime's cost is 45% input audio (which includes earlier turns
re-billed as context, pruned here to 2 turns), 45% output audio, 7% text and 3% side transcription.

## 4. Controllability: control plane vs. media plane

- **Realtime is vertically integrated:** the vendor owns both planes. We control the prompt, the voice
  and turn boundaries. Recognition, translation and synthesis are one opaque step: unmeasurable,
  unswappable, and the source of the run-to-run variance above. Its source transcript comes from a
  separate model and is, in OpenAI's words, "guidance".
- **Prompt-level control does work in Realtime, but it is a request, not a guarantee.** Realtime's
  prompt fixed terminology too (13 of 14 glossary terms), so "only the cascade has levers" was too
  strong. The difference is how strongly each lever binds: DeepL's formality and glossary are API
  parameters enforced by the provider, deterministic and auditable per term, whereas Realtime follows
  an instruction it usually honours. In the same run, Realtime once re-spoke the previous turn's
  translation instead of the new sentence ([translation-controls.md](translation-controls.md)).
- **The cascade lets us own the media plane:** every stage is timed (on screen and in the report),
  swappable by config, and tunable. The tuning points:
  - commit policy (the measured 0.22 s p50 gain of clause vs. segment, at a fluency cost);
  - translation prompt, glossary and formality;
  - STT model and voice per language;
  - per-stage timeouts, retry and DeepL failover, recorded on the turn.

## 5. Provider flexibility

Swapping the cascade's translator from OpenAI to DeepL was a URL or config value: no code changed.

| | p50 / p95 | Server first token |
|---|---|---|
| OpenAI translator | 1.43 / 1.89 s | 0.46 s |
| DeepL translator | 1.15 / 1.25 s | 0.33 s |

Judge accuracy was unchanged (4.96). DeepL also serves as the automatic failover after repeated 429s.
Realtime's only lever is the model version.

## 6. Time to onboard a language pair

EN ↔ FR took **one config change** (1 language + 1 pair, 12 lines) plus 2 clips per direction, about
2 minutes. Both architectures worked first time (Realtime 1.00-1.41 s, cascade 1.28-1.42 s; see
[onboarding.md](../harness/results/onboarding.md)).

Effort is equal for a well-supported language. The difference shows when a language is poorly
supported: the cascade can route just that language to a specialist STT, translator or voice.

Disclosure: French conjunctions (clause policy) and number words (report) had been added earlier,
about 10 lines.

## 7. Stability: 5-minute soak per mode

Both modes completed 45 turns with no failures and no unplanned disconnects. The forced transport drop
recovered to Ready in 2.1 s (Realtime) and 1.1 s (Cascade), with transcripts kept. The cascade had no
playback underruns; Realtime's jitter buffer is the browser's and can't be observed. The post-GC heap
floor grew 4.9 MB (Realtime) and 3.7 MB (cascade) over 45 turns, consistent with retained transcripts; 5 minutes
cannot rule out a slow leak. How production would manage it: [production.md](production.md).

## 8. Recommendation by scenario

| Scenario | Use | Why |
|---|---|---|
| Low-stakes conversational (front desk, scheduling) | **Realtime** | Fastest at p50 (1.09 s), natural, nothing to operate. Quality was equal on this set. |
| Regulated / clinical consults, audit required | **Cascade** (DeepL with formality + glossary) | Every stage measured and logged. Register and terminology enforced by the provider, not just requested: 9/9 formal, 14/14 glossary terms in the follow-up. Data path and providers are ours. 4.8× cheaper. |
| Strict latency SLOs | **Cascade with DeepL** | p95 1.25 s, stable across runs. Realtime's p95 ranged 1.06-1.72 s run to run. |
| Terminology-heavy (medications, legal, insurance) | **Cascade** with a glossary-capable translator | A provider-enforced glossary is deterministic and auditable. Realtime's prompt fixed terminology too (13/14), but only as an instruction. |
| Uncommon language pairs | **Cascade** | Pick the best STT, translator and voice per language. |
| High volume, cost-sensitive | **Cascade** | $0.043/min vs. $0.210/min. |

Use **segment** commits by default; **clause** is 0.22 s faster at p50 but its seams cost fluency.
In practice, run both behind the same UI and route per tenant or per call type.

## Disclosures

- **Synthetic clips.** Clean, single-voice speech (ElevenLabs). Real callers will raise WER and stress endpointing.
- **Network path.** Realtime goes browser-direct to OpenAI over WebRTC. The cascade adds a backend hop (browser → ASP.NET Core → providers); negligible on localhost, a real leg when deployed.
- **Consecutive playback favors the cascade.** It translates and synthesizes during speech and can start playing at release, while Realtime only starts generating after the commit.
  - Most of these sentences are a single segment, so the advantage mostly did not apply.
  - In clause mode it did: longer sentences reached first audio at 0.56-0.59 s, essentially at release.
- **Realtime's source transcript is a side transcription process** (gpt-4o-transcribe, asynchronous, "guidance" per OpenAI), so its WER does not measure what the model understood.
- **Push-to-talk.** Both modes use two push-to-talk buttons (deterministic turns, fair timing). That is less natural than hands-free conversation, and the latencies here exclude any voice-activity endpointing a hands-free product would add.
- **Release lag.** Release came about 0.41 s after T0 in every configuration (clip tail plus automated release), and both architectures wait for release.
- **Output measurement differs.** Cascade first-audible includes the device's output latency; Realtime's AnalyserNode sees samples just before it. This favors Realtime by tens of ms.
- **Automated judge.** Quality scores come from gpt-4.1-mini; spot-check them with the human sheet in MORNING.md. Target WER against one reference is a crude proxy.

## Path to production

At scale the control and media modules split into separate services.

- **Control plane:** stateless behind a load balancer. Sessions, turn state, routing, client-secret minting, policy and audit.
- **Media plane:** stateful per call, placed near the providers, scaled on concurrent streams. Runs the cascade pipelines.
- **Between them:** a stream bus for events and audio.

Realtime calls bypass the media plane entirely, while the control plane still mints their secrets and
records usage. The normalized event schema and the measurements used here (T0, first audible, stage
timings) carry over unchanged, so these numbers become production SLOs.
