# Realtime vs. Cascade: comparison and recommendation

All numbers are measured and come from [`harness/results/report.md`](../harness/results/report.md)
(run of 2026-10-15). Setup: 24 synthetic clinic sentences (12 EN → ES, 12 ES → EN), each played
through the app's capture path with push-to-talk automated. p50/p95 per configuration, never single runs.

## 1. Latency: mouth-to-ear (speech end T0 → first audible)

| Configuration | p50 | p95 | Target | Release → first audible (p50) |
|---|---|---|---|---|
| Realtime (gpt-realtime, WebRTC) | **0.89 s** | **1.06 s** | < 1.5 s ✔ | 0.48 s |
| Cascade · segment (Deepgram → gpt-4.1-nano → ElevenLabs Flash) | 1.41 s | 1.65 s | < 3 s ✔ (stretch < 2 s ✔) | 1.01 s |
| Cascade · clause | 1.20 s | 1.46 s | < 2 s ✔ | 0.81 s |
| Cascade · segment, DeepL translator | 1.15 s | 1.22 s | < 3 s ✔ (stretch ✔) | 0.74 s |

- **Stage breakdown (cascade · segment, p50 after T0):**
  - release 0.41 s;
  - STT final 0.58 s (Deepgram finalizes about 170 ms after release);
  - translation first token 1.03 s;
  - TTS first byte 1.30 s;
  - first audible 1.41 s.
- **Where the cascade loses time:** almost entirely in the LLM's time to first token and the TTS first byte. DeepL wins on latency here despite not streaming, because its whole-segment answer arrives faster than gpt-4.1-nano's first token.
- **Realtime:** response start comes 0.52 s after T0. Its internal stages are not observable and are shown as "hidden".
- **Access time** (press → transport accepting audio) is about 20 ms for the cascade. For Realtime it is effectively 0, because the WebRTC track is already live.

## 2. Quality

| Configuration | Source WER | Target WER vs. reference (crude proxy) | Accuracy / Completeness / Fluency (automated judge, 1-5) | Answered instead of interpreted |
|---|---|---|---|---|
| Realtime | 0.000 (side transcription) | 0.114 | 4.96 / 4.96 / 4.96 | 0 / 24 |
| Cascade · segment | 0.000 | 0.061 | 4.96 / 5.00 / 5.00 | 0 / 24 |
| Cascade · clause | 0.000 | 0.088 | 4.83 / 4.88 / 4.71 | 0 / 24 |
| Cascade · DeepL | 0.000 | 0.293 | 4.96 / 5.00 / 4.96 | 0 / 24 |

- **Neither architecture answered a question instead of interpreting it**, across the 7 questions × 4 configurations.
- **Clause commits trade quality for speed.** Translating clause by clause produced audible seams:
  - "The child fell down. and hurt his left arm."
  - "¿Duele? ¿Cuando respira profundamente?"
  - "No comas o beber algo" (a grammatical slip).
- **Terminology and register differ in ways WER barely shows:**
  - Realtime and DeepL both rendered "receta" as *recipe*; the OpenAI cascade said *prescription*.
  - DeepL used informal *tú* throughout, which is wrong for a clinic.
  - Realtime used formal *usted*; the OpenAI cascade mixed the two.
  - These are exactly the errors a glossary or formality setting fixes, and only the cascade has those settings.
- **WER near zero** reflects clean synthetic speech. Real callers, accents and noise will raise it.

## 3. Cost per minute of input speech

Logged usage × verified prices (read 2026-10-15; see [`harness/pricing.json`](../harness/pricing.json)):

| Configuration | USD per minute |
|---|---|
| Realtime | **0.205** |
| Cascade · segment / clause | **0.043** |
| Cascade · DeepL | 0.066 (DeepL rate UNVERIFIED; this run used a Free key) |

At these prices the cascade is about **4.7× cheaper** per minute. Realtime's cost splits about evenly between input audio tokens (which include earlier turns re-billed as context, pruned here to the last 2 turns) and output audio tokens; text tokens and side transcription add about 10%.

## 4. Controllability: control plane vs. media plane

- **Realtime is vertically integrated.**
  - The vendor owns both planes: recognition, translation, voice and pacing happen inside one model.
  - We control the prompt, the voice, and when a turn starts and ends.
  - Internal stages cannot be measured, swapped or tuned.
  - Its source transcript comes from a separate transcription model and is "guidance", not what the model heard.
- **The cascade lets us own the media plane.** Every stage is measured (the waterfall in the UI) and swappable by config (the DeepL run). It is tunable at each step:
  - commit policy: the measured segment/clause latency-vs-quality trade;
  - translation prompt, glossary and formality;
  - choice of STT model per language;
  - voice per language;
  - per-stage timeouts, retry and failover (exercised in tests, recorded on the turn).

## 5. Provider flexibility

Swapping the cascade's translator from OpenAI to DeepL was a URL/config change, with no code change.
Effect, measured:

- p50 mouth-to-ear **1.41 → 1.15 s**;
- first token **1.03 → 0.90 s** after T0;
- judge accuracy unchanged (4.96);
- target WER **0.06 → 0.29**, mostly the informal register.

DeepL is also wired as the automatic failover after repeated 429s. With Realtime the only lever is the model version.

## 6. Time to onboard a language pair

EN ↔ FR was added with **one config change** (appsettings.json: 1 language + 1 pair, 12 lines), plus
2 clips per direction for evaluation. It took about 2 minutes, and both architectures worked first time
(Realtime 1.00-1.41 s, cascade 1.28-1.42 s; [onboarding.md](../harness/results/onboarding.md)).

- **Equal effort for a well-supported pair.** The difference is what happens when a language is not
  well supported: the cascade can route just that language to a specialist STT, translator or voice;
  Realtime cannot.
- **Disclosure:** French conjunctions (clause policy) and number words (report) had been written
  earlier, about 10 lines.

## 7. Stability: 5-minute soak per mode

| Mode | Turns | Failed | Unplanned disconnects | Forced drop → Ready | Heap floor 1st → last minute |
|---|---|---|---|---|---|
| Realtime | 45 | 0 | 0 | 2.1 s, transcripts kept | 12.6 → 17.5 MB |
| Cascade | 45 | 0 | 0 | 1.1 s, transcripts kept | 12.4 → 16.1 MB |

- No unplanned disconnects or failed turns in either mode, and no playback underruns in the cascade. Realtime's jitter buffer is the browser's and is not observable.
- The heap floor grew about 4-5 MB over 45 turns in both modes, consistent with the retained transcripts.
- 5 minutes cannot rule out a slow leak.

## 8. Recommendation by scenario

| Scenario | Recommended | Why |
|---|---|---|
| Low-stakes conversational (front desk, scheduling, general questions) | **Realtime** | About 0.5 s faster at p50 (0.89 vs. 1.15-1.41 s), the most natural turn-taking, nothing to operate. Quality was equal on this set. |
| Regulated / clinical consults, anything that must be audited | **Cascade · segment** | Every stage is measured and logged. A glossary and formality setting fix the *recipe* and *tú* errors. Provider choice and data paths are ours. Cost is about 4.7× lower. Latency (1.4 s) is well inside 3 s. |
| Terminology-heavy domains (medications, legal, insurance) | **Cascade** with a glossary-capable translator | Terminology is controllable per stage. Realtime's only lever is the prompt. |
| Uncommon language pairs | **Cascade** | Mix the best STT, translator and voice per language. Realtime coverage is one vendor's model. |
| High volume, cost-sensitive | **Cascade** | $0.043/min vs. $0.205/min at today's prices. |

Use **segment** commits by default. **Clause** is 0.2 s faster at p50, but its mid-sentence seams cost fluency (4.71).
A practical product runs both behind the same UI: Realtime for low-stakes calls, the cascade
for regulated work and uncommon pairs, with per-tenant routing.

## Disclosures

- **Clips are synthetic speech** (ElevenLabs, clean, single speaker per clip). Real-world WER and endpointing will be worse.
- **Realtime goes browser-direct** to OpenAI over WebRTC, **while the cascade adds a backend hop** (browser → ASP.NET Core → providers). On localhost the hop is negligible; deployed, it adds a network leg.
- **Consecutive playback favors the cascade** on the headline metric. The cascade translates and synthesizes during speech and can start playing at release, while Realtime only starts generating after the commit at release.
  - With these short sentences most turns were a single segment, so the advantage mostly did not apply.
  - In clause mode it did: three longer sentences reached first audio 0.56-0.59 s after T0, essentially at release.
- **Realtime's source transcript comes from a side transcription process** (gpt-4o-transcribe, run asynchronously; OpenAI docs call it "guidance"), so its WER does not measure what the speech-to-speech model understood.
- **Release lag is included for every configuration.** Release came about 0.41 s after T0 (clip tail plus automated release), and both architectures wait for release before finishing. Mouth-to-ear therefore includes a realistic human release lag.
- **Measurement points differ slightly at the output.** Cascade first-audible maps the playback context time to the moment the sample reaches the speaker (`getOutputTimestamp`), while Realtime's AnalyserNode sees the remote samples before the device's output latency. This favors Realtime by that latency (typically tens of ms; more on Bluetooth).
- **Quality scores** are from an automated judge (gpt-4.1-mini) and should be spot-checked with the human sheet in MORNING.md. Target WER against one reference is a crude proxy.

## Path to production

At scale the control and media modules become separate services. The **control plane** handles
sessions, turn state, routing, client-secret minting, policy and audit; it is stateless behind a
load balancer. The **media plane** runs the cascade pipelines; it is stateful per call, placed near
the providers, and scaled on concurrent streams. They talk over a queue/stream for events and audio.
Realtime sessions bypass the media plane entirely (browser-direct), and the control plane still mints
their secrets and records usage. The same normalized event schema and metrics (T0, first audible,
stage timings) carry over, so the measurements here become production SLOs.
