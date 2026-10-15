# Good morning

The workbench should already be running: **http://localhost:5173**

If it isn't, start it from this folder (backend :5080 + client :5173):

```bash
npm run dev
```

Everything was built, tested and measured overnight. The recommendation is in
[`docs/comparison.md`](docs/comparison.md). The full numbers are in
[`harness/results/report.md`](harness/results/report.md).

## Headline results (measured; Realtime 72 turns over 3 runs, each cascade 48 turns over 2 runs)

| Configuration | Mouth-to-ear p50 | p95 | Target | Cost / min | Judge accuracy |
|---|---|---|---|---|---|
| Realtime (gpt-realtime) | **1.09 s** | 1.46 s | < 1.5 s ✔ (barely) | $0.210 | 4.96 |
| Cascade · segment (Deepgram → gpt-4.1-nano → ElevenLabs) | 1.43 s | 1.89 s | < 3 s ✔, < 2 s ✔ | **$0.043** | 4.96 |
| Cascade · clause | 1.21 s | 1.44 s | < 2 s ✔ | $0.044 | 4.83 |
| Cascade · DeepL translator | 1.15 s | **1.25 s** | < 3 s ✔ | $0.066* | 4.96 |

\*DeepL price unverified (Free key).

- **Realtime varied run to run.** Its p95 per run was 1.06, 1.72 and 1.36 s; the swing is in OpenAI's time to first audio. The DeepL cascade was the steadiest configuration.
- No question was answered instead of interpreted, in any configuration.
- **Soak (5 min per mode):** 45 turns each, 0 failures, 0 unplanned disconnects. Forced-drop recovery was 2.1 s (Realtime) and 1.1 s (Cascade), with transcripts kept.
- **EN ↔ FR** was onboarded with one config change in about 2 minutes, and worked in both modes.

## 5-minute guided test

Use headphones, so the interpretation doesn't feed back into the other speaker's mic.

1. **Open http://localhost:5173.**
   - Expected: the connection pill says "WebSocket connected".
   - The two round buttons turn teal ("Hold to talk").
   - The status line reads "Ready. Each speaker holds their own button."
   - If Chrome asks for the microphone, allow it.
2. **Cascade, English speaker.**
   - Hold **English speaker** (or focus it and hold Space) and say *"My son has had a fever since last night."*
   - Release a moment after you finish.
   - Expected: the button pulses while you talk, and grey partial words turn black as they become final.
   - The Spanish text streams in, and the Spanish audio plays right after release.
   - The latency panel fills in: the headline value, plus the waterfall rows Release → STT final → Translate 1st tok → TTS first byte → First audible.
3. **Floor control.**
   - While that interpretation is still playing, press **Hablante de español**.
   - Expected: a short two-note tone, the button shakes, and it shows "Floor busy". Nothing is queued.
4. **Spanish speaker.**
   - Hold **Hablante de español** and say *"Tengo una cita a las tres con la doctora."*
   - Expected: English text and audio.
5. **Mode switch mid-turn.**
   - Start holding a button, and while holding, click **Realtime** in the header.
   - Expected: a banner reads "Switching to Realtime after this turn finishes playing."
   - After playback, the pill says "WebRTC connected".
6. **Realtime.**
   - Repeat a sentence in either language.
   - Expected: faster first audio (p50 about 1.1 s on the clips). The waterfall shows "STT / LLM / TTS: hidden", and the source transcript may arrive after the audio.
   - **Manual check (real Chrome):** if Realtime was the first mode you used on page load, confirm the interpretation is audible on your first press. Browsers block audio until a user gesture; the app starts it from the press, but only Chromium with an autoplay flag was tested overnight.
7. **Compare.**
   - Look at the **Session p50 / p95** table: the Target cell is green when p95 is under target.
   - Click **Export session metrics** to download every turn's marks as JSON.
8. **Optional.**
   - Choose **Clause** in Cascade mode and say a longer sentence with a comma.
   - Choose a **Replay:** clip as the Input, then click a speaker's button to replay it.
   - Try `http://localhost:5173/?providers=fake&faults=translation:429` to see the failover toast without spending anything.

## Human scoring (done)

The blind human spot-check was done on 2026-10-15: 20 turns, 10 per mode, scored on a page that
hid the pipeline. Results are in `harness/results/human-scores.json` and report section 2
("Human spot-check"): 44 of 60 scores identical to the automated judge, all within one point.

Things the judge under-weighted overnight: register (DeepL used informal *tú*) and terminology
("receta" → *recipe* instead of *prescription* in Realtime and DeepL). Both are now fixed by the
translation controls, which are on by default; see
[`docs/translation-controls.md`](docs/translation-controls.md). Use the header's **Clinic terms | Off** toggle (or `?controls=off`) to hear the baseline; each turn card says which was used.

## Blocked or partial

Nothing is blocked. These items are partial or are deviations; each is logged in PROGRESS.md under Decisions:

- **No .NET SDK was installed.** I installed .NET 10 into the repo-local `.dotnet/` (gitignored). `npm run dev` uses it automatically; a normal SDK install also works.
- **STT final timeout has no retry** (after release there is no audio left to resend). The pipeline keeps what was heard.
- **Harness runs used:** Realtime 3 of 3 (run 2 was slow on OpenAI's side, so a third run settled it); each cascade configuration 2 of 3.
- **mic_denied** is tested by making `getUserMedia` reject, because headless Chromium ignores the deny flags.
- **The DeepL price is unverified.**

## Suggested next steps

1. **Run with real people:** a 10-minute session per mode with real voices and accents, then compare against the synthetic numbers.
2. ~~**Add a glossary and formality controls**~~ **Done:** see [`docs/translation-controls.md`](docs/translation-controls.md). Next: test the glossary on held-out sentences, since this one was written after seeing the test set's errors.
3. **Try `gpt-realtime-translate` and `gpt-realtime-2.x`** (newer than the locked model) through the same harness.
4. **Smooth the clause seams:** pass the next segment's context, or merge fragments shorter than a few words.
5. **Run a 30-minute soak** with forced GC to settle the slow-leak question.
6. **Path to production:** split the control and media modules into services (see the end of comparison.md).
