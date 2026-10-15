# Translation controls: formal register and clinic glossary

A follow-up to the evaluation. The baseline runs showed two clinic-specific translation errors that
WER and the automated judge barely penalized. This change adds two controls aimed at them, and
measures what they did in both architectures.

Results: [`harness/results-controls/report.md`](../harness/results-controls/report.md) (generated).
Baseline: [`harness/results/report.md`](../harness/results/report.md) (unchanged).

## The problem

| Error | Where | Example |
|---|---|---|
| **Informal register** | DeepL used *tú* in 14 of 18 Spanish sentences that address the listener; the OpenAI translator in 2 of 16 | "¿Te duele cuando respiras profundamente?" instead of "¿Le duele cuando respira…?" |
| **Wrong term** | Realtime and DeepL | "No entiendo las instrucciones de la receta" → "…the *recipe* instructions" (should be *prescription*) |

In a medical consultation both matter. Informal address to a patient sounds wrong, and a mistranslated
medication term is a safety issue.

## What was built

Two controls, configured once and applied in each pipeline the way that pipeline allows:

| Control | DeepL (cascade) | OpenAI translator (cascade) | gpt-realtime |
|---|---|---|---|
| Formal register | `formality: "prefer_more"` (API parameter) | prompt instruction: "address the listener formally (usted, never tú)" | the same prompt instruction |
| Clinic glossary | a DeepL **glossary** (API object) | the term list in the prompt ("required terminology") | the same term list in the session prompt |

- **Configuration:** `TranslationControls` in [`appsettings.json`](../server/src/Workbench.Api/appsettings.json):
  `Enabled`, `Formal`, and `Glossary` per direction (`"en-es"`, `"es-en"`). Source term → required
  target term.
- **Default:** on. Switch it with the header's **Clinic terms | Off** toggle (between turns, both modes), or set
  the initial value with `?controls=off` / `?controls=on` in the URL. Each turn card shows "Clinic terms on/off".
  The baseline harness configurations pin `controls=off`, so the original runs stay reproducible.
- **Code:**
  - `TranslationControls` in `Workbench.Core/Contracts`. It travels on each turn
    (`CascadeTurnSpec` → `TranslationContext`) and in the Realtime session request.
  - `InterpreterPrompt.Controls` builds the shared prompt wording.
  - `DeepLTranslationProvider` handles formality and the glossary.

### DeepL glossary details (verified against the live API, 2026-10-15)

- **One glossary for all directions.** The adapter uses DeepL's multilingual (v3) glossaries: one glossary
  holding a dictionary per direction. The **Free plan allows only one glossary in total** (`456 Too many
  glossaries`), so a glossary per direction would fail.
- **Created lazily and reused.** The glossary's name embeds a hash of all entries, so editing the config
  creates a new one. Before creating, the adapter deletes only its own stale `workbench-*` glossaries.
  It never touches other glossaries on the account.
- **Matching is literal.** The bare entry "receta → prescription" did **not** fire inside "de la receta";
  adding the noun phrase "la receta → the prescription" did. The config therefore lists common article
  forms ("la receta", "una receta", "the prescription", "any medication", …).
- **Best effort.** If the glossary can't be created, the turn is translated without it rather than
  failing.

## Results (24 clips per pipeline with controls on, against the pooled baseline)

| Pipeline | Formal Spanish (sentences that address the listener) | Glossary terms used | Target WER (proxy) | Mouth-to-ear p50 / p95 | Cost / min |
|---|---|---|---|---|---|
| Cascade · DeepL | 4/18 → **9/9** | 18/28 → **14/14** | 0.293 → 0.205 | 1.15 / 1.25 → 1.21 / 1.41 s | $0.066 → $0.065 |
| Cascade · OpenAI | 14/16 → **8/8** | 26/28 → **14/14** | 0.059 → 0.086 | 1.43 / 1.89 → 1.52 / 1.85 s | $0.043 → $0.044 |
| Realtime | 22/22 → 7/7 (already formal) | 38/42 → 13/14 | 0.097 → 0.153 | 1.09 / 1.46 → 1.09 / 1.31 s | $0.210 → $0.212 |

- **Both errors are fixed.** "Receta" now comes out as *prescription* in every pipeline, and every
  Spanish sentence that addresses the listener is formal.
- **DeepL gained the most.** It went from mostly informal to fully formal, and its target WER fell by
  0.09.
- **Cost and latency barely moved.** The p95 shifts are within run-to-run noise: the "after" runs are
  24 turns each, against 48-72 pooled baseline turns.
- **WER rose slightly for the OpenAI translator.** The forced wording ("the instructions of the
  prescription", "do not" instead of "don't") is correct but differs from the single reference
  sentence. WER is a crude proxy here.

### One Realtime error

On clip en-05 ("Please take one tablet twice a day with food."), Realtime spoke the **previous clip's**
translation ("El dolor empezó después del almuerzo…") instead of translating the new audio. That one
turn accounts for most of Realtime's WER rise and for its only glossary miss ("one tablet").

Realtime had no such error in its 72 baseline turns. With a single occurrence, it is not possible to
tell whether the longer prompt made it more likely. The report now flags this class of error
automatically (an output that matches another clip's reference better than its own).

## What this means for the comparison

- **Realtime's prompt fixed terminology too** (13 of 14 terms, with the miss caused by the wrong-utterance
  error). So "only the cascade has these levers" was too strong.
- **The difference is how strongly each lever binds.** In the cascade, formality is an API parameter and
  the glossary is enforced by DeepL itself; both are deterministic, testable and auditable per term. In
  Realtime the same instructions are a request the model usually follows. For regulated use,
  enforcement and auditability are what matter, and that still favours the cascade.
- **A practical recipe** for a clinical deployment is the DeepL cascade with formality and a curated
  glossary. Here it was the steadiest on latency (p95 1.25-1.41 s) and fully formal with every glossary
  term honoured.

## Caveats

- **Teaching to the test.** The glossary was written after seeing the baseline errors on this same clip
  set, and several entries match these sentences. The experiment shows the controls work and what they
  cost. It is not an unbiased estimate on unseen sentences; a fair test needs held-out sentences.
- **Small "after" sample:** one run of 24 turns per pipeline.
- **Register is classified by an automated judge** (gpt-4.1-mini, cached), counting only sentences that
  address the listener. Glossary adherence is a deterministic check on the head noun of each required
  term.
- **The glossary covers English ↔ Spanish only.** French has formality support in DeepL but no
  glossary entries yet.

## Re-running

```bash
HARNESS_RESULTS_DIR=results-controls HARNESS_CONFIGS=realtime-controls,cascade-segment-controls,cascade-deepl-controls npx playwright test -c harness/playwright.harness.config.ts run.harness.ts
npx tsx harness/controls-report.ts
```

The cost guardrail (3 runs per configuration) applies to the control configurations too; each has
used 1.
