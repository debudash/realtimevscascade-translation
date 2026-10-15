# Evaluation harness

Measures both architectures on the same 24 synthetic clinic clips (12 EN, 12 ES) and writes
`results/report.md`. Everything here uses the real providers and costs money; the cost guardrails
from CLAUDE.md are enforced in code.

| File | What it does |
|---|---|
| `scripts.json` | The sentences: what the synthetic speaker says (reference transcript) and the reference translation. |
| `generate-clips.ts` | Generates `clips/*.wav` once with ElevenLabs (16 kHz mono, trimmed to 250 ms lead / 150 ms tail). Never regenerates an existing clip. |
| `run.harness.ts` | Plays every clip through the app's Replay input (same capture path as the mic, press/release automated) in four configurations and saves each run to `results/runs/`. Refuses a 4th run per configuration. |
| `soak.harness.ts` | 5 minutes of alternating EN/ES turns per mode, with one forced transport drop at the midpoint. One run per mode. |
| `metrics.ts` | WER, percentiles, the "answered instead of interpreted" heuristic, cost per turn (unit-tested). |
| `report.ts` | `npm run report`: aggregates the latest run per configuration + soak + automated judge into `results/report.md`. |
| `pricing.json` | Prices used for cost per minute, with the date they were read. |

## Configurations

| Key | URL | Pipeline |
|---|---|---|
| `realtime` | `/?mode=realtime` | gpt-realtime over WebRTC |
| `cascade-segment` | `/` | Deepgram nova-3 → OpenAI gpt-4.1-nano (streamed) → ElevenLabs Flash v2.5, segment commits |
| `cascade-clause` | `/?strategy=clause` | same, clause commits |
| `cascade-deepl` | `/?providers=translation:deepl` | same as segment with DeepL as the primary translator (config change only) |

## Run

```bash
npx tsx harness/generate-clips.ts                                   # once
npx playwright test -c harness/playwright.harness.config.ts run.harness.ts
npx playwright test -c harness/playwright.harness.config.ts soak.harness.ts
npm run report
```

`HARNESS_CONFIGS=realtime,cascade-clause` and `SOAK_MODES=cascade` limit what runs. The harness
starts `npm run dev` itself if the app is not already running.

**Translation controls experiment** (formal register + clinic glossary; results in `results-controls/`):

```bash
HARNESS_RESULTS_DIR=results-controls HARNESS_CONFIGS=realtime-controls,cascade-segment-controls,cascade-deepl-controls   npx playwright test -c harness/playwright.harness.config.ts run.harness.ts
npx tsx harness/controls-report.ts     # before/after vs. results/ → results-controls/report.md
```
