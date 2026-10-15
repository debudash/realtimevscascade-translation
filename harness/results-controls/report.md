# Translation controls: before / after

Generated 2026-10-15T12:10:37.429Z by `npx tsx harness/controls-report.ts`.

**What changed:** the same 24 clips and pipelines, with translation controls on (`?controls=on`):
- **Formal register:** DeepL `formality: prefer_more`; for the OpenAI translator and Realtime, an instruction to address the listener formally (usted).
- **Clinic glossary** (`TranslationControls.Glossary` in appsettings.json): a DeepL multilingual glossary; for the OpenAI translator and Realtime, the same terms listed in the prompt.

**Before** = baseline runs in `harness/results/runs` (controls off, all saved runs pooled). **After** = `harness/results-controls/runs`.

## Results

| Pipeline | Formal address (ES outputs that address the listener) | Glossary terms honoured | Target WER (proxy) | Mouth-to-ear p50 / p95 | Cost / min | Completed |
|---|---|---|---|---|---|---|
| Realtime (gpt-realtime) | 22/22 formal → **7/7 formal** | 38/42 → **13/14** | 0.097 → 0.153 | 1.09 s / 1.46 s → 1.09 s / 1.31 s | $0.2096 → $0.2121 | 72/72 → 24/24 |
| Cascade · segment (Deepgram · OpenAI · ElevenLabs) | 14/16 formal → **8/8 formal** | 26/28 → **14/14** | 0.059 → 0.086 | 1.43 s / 1.89 s → 1.52 s / 1.85 s | $0.0433 → $0.0439 | 48/48 → 24/24 |
| Cascade · segment, DeepL primary (Deepgram · DeepL · ElevenLabs) | 4/18 formal → **9/9 formal** | 18/28 → **14/14** | 0.293 → 0.205 | 1.15 s / 1.25 s → 1.21 s / 1.41 s | $0.0658 → $0.0648 | 48/48 → 24/24 |

- **Realtime + controls (prompt only)**, glossary misses after: "one tablet" → "una tableta"
- **Realtime + controls (prompt only)**, Spanish outputs that address the listener: 7 formal, 0 informal (before: 22 formal, 0 informal).
- **Cascade · segment + controls (OpenAI prompt)**, Spanish outputs that address the listener: 8 formal, 0 informal (before: 14 formal, 2 informal).
- **Cascade · DeepL + controls (formality + glossary)**, Spanish outputs that address the listener: 9 formal, 0 informal (before: 4 formal, 14 informal).

### Wrong-utterance errors (output matches a different clip better than its own)

| Run | Clip said | Output | Diagnosis |
|---|---|---|---|
| realtime-controls (after) | en-05: "Please take one tablet twice a day with food." | "El dolor empezó después del almuerzo y está empeorando." | matches en-04 (WER 0.00 vs own 1.00) |

Realtime keeps the last 2 turns as conversation context; on these turns it re-spoke an earlier translation instead of the new audio. This is the main cause of Realtime's target-WER change, not the controls' wording itself (one occurrence, so the cause cannot be attributed).

**How these are measured.**
- *Formal address:* each Spanish output (EN → ES turns) is classified formal / informal / neutral by an automated judge (gpt-4.1-mini, temperature 0, cached); neutral sentences (that do not address the listener) are excluded.
- *Glossary terms honoured:* for every glossary term that occurs in the clip's source sentence, whether the required translation's head noun appears in the output. Deterministic.
- *Target WER* is against the single reference translation (crude proxy). Latency and cost as in the main report.

**Caveat (teaching to the test).** The glossary was written after seeing the baseline errors on this same clip set, and several entries match these sentences. It shows that the levers work and what they cost; it is not an unbiased quality estimate on unseen sentences.

## Appendix: outputs before → after

| Pipeline | Clip | Before (controls off) | After (controls on) |
|---|---|---|---|
| realtime-controls | en-01 | Mi hijo ha tenido fiebre desde anoche. | Mi hijo ha tenido fiebre desde anoche. |
| realtime-controls | en-02 | ¿Es alérgico a algún medicamento? | ¿Es alérgico a algún medicamento? |
| realtime-controls | en-03 | Necesito mover mi cita al viernes por la mañana. | Necesito cambiar mi cita al viernes por la mañana. |
| realtime-controls | en-04 | El dolor empezó después del almuerzo y está empeorando. | El dolor comenzó después del almuerzo y está empeorando. |
| realtime-controls | en-05 | Por favor, tome una tableta dos veces al día con comida. | El dolor empezó después del almuerzo y está empeorando. |
| realtime-controls | en-06 | ¿Ha tenido alguna cirugía en los últimos cinco años? | ¿Ha tenido alguna cirugía en los últimos cinco años? |
| realtime-controls | en-07 | Su presión arterial está un poco alta hoy. | Su presión arterial está un poco alta hoy. |
| realtime-controls | en-08 | Lo llamaremos cuando los resultados de las pruebas estén listos. | Le llamaremos cuando los resultados de las pruebas estén listos. |
| realtime-controls | en-09 | ¿Le duele cuando respira hondo? | ¿Le duele cuando respira hondo? |
| realtime-controls | en-10 | Ha estado tosiendo durante dos semanas y no puede dormir. | Ella ha estado tosiendo durante dos semanas y no puede dormir. |
| realtime-controls | en-11 | No coma ni beba nada después de la medianoche antes del procedimiento. | No coma ni beba nada después de medianoche antes del procedimiento. |
| realtime-controls | en-12 | ¿Cuál es su fecha de nacimiento? | ¿Cuál es su fecha de nacimiento? |
| realtime-controls | es-01 | I have an appointment at three with the doctor. | I have an appointment at three o’clock with the doctor. |
| realtime-controls | es-02 | I don’t understand the instructions of the recipe. | I do not understand the instructions of the prescription. |
| realtime-controls | es-03 | My spouse needs an interpreter tomorrow. | My spouse needs an interpreter tomorrow. |
| realtime-controls | es-04 | How many times a day should they take it? | How many times a day should they take it? |
| realtime-controls | es-05 | I’ve had a really bad headache since yesterday. | I have a severe headache since yesterday. |
| realtime-controls | es-06 | My daughter is allergic to penicillin. | My daughter is allergic to penicillin. |
| realtime-controls | es-07 | Can I take this medication on an empty stomach? | Can I take this medication on an empty stomach? |
| realtime-controls | es-08 | I have diabetes and I take insulin every morning. | I have diabetes and I take insulin every morning. |
| realtime-controls | es-09 | The child fell and hurt his left arm. | The child fell and hurt their left arm. |
| realtime-controls | es-10 | How long do I have to wait to see the doctor? | How long do I have to wait to see the doctor? |
| realtime-controls | es-11 | I don’t have health insurance, but I can pay in cash. | I don’t have health insurance, but I can pay in cash. |
| realtime-controls | es-12 | I need a new prescription because I’ve run out of my pills. | I need a new prescription because I ran out of the pills. |
| cascade-segment-controls | en-01 | Mi hijo ha tenido fiebre desde anoche. | Mi hijo ha tenido fiebre desde anoche. |
| cascade-segment-controls | en-02 | ¿Es alérgico a algún medicamento? | ¿Es alérgico a algún medicamento? |
| cascade-segment-controls | en-03 | Necesito mover mi cita al viernes por la mañana. | Necesito mover mi cita al viernes por la mañana. |
| cascade-segment-controls | en-04 | El dolor comenzó después del almuerzo y está empeorando. | El dolor comenzó después del almuerzo y está empeorando. |
| cascade-segment-controls | en-05 | Por favor, tome una tableta dos veces al día con comida. | Por favor, tome una tableta dos veces al día con comida. |
| cascade-segment-controls | en-06 | ¿Ha tenido alguna cirugía en los últimos cinco años? | ¿Ha tenido alguna cirugía en los últimos cinco años? |
| cascade-segment-controls | en-07 | Tu presión arterial está un poco alta hoy. | Su presión arterial está un poco alta hoy. |
| cascade-segment-controls | en-08 | Le llamaremos cuando los resultados de la prueba estén listos. | Le llamaremos cuando los resultados de las pruebas estén listos. |
| cascade-segment-controls | en-09 | ¿Le duele cuando respira profundamente? | ¿Le duele cuando respira profundamente? |
| cascade-segment-controls | en-10 | Ella ha estado tosiendo durante dos semanas y no puede dormir. | Ella ha estado tosiendo durante dos semanas y no puede dormir. |
| cascade-segment-controls | en-11 | No coma ni beba nada después de la medianoche antes del procedimiento. | No coma ni beba nada después de la medianoche antes del procedimiento. |
| cascade-segment-controls | en-12 | ¿Cuál es su fecha de nacimiento? | ¿Cuál es su fecha de nacimiento? |
| cascade-segment-controls | es-01 | I have an appointment at 3 with the doctor. | I have an appointment at 3 with the doctor. |
| cascade-segment-controls | es-02 | I don't understand the instructions on the prescription. | I do not understand the instructions on the prescription. |
| cascade-segment-controls | es-03 | My wife needs an interpreter tomorrow. | My wife needs an interpreter tomorrow. |
| cascade-segment-controls | es-04 | How many times a day should I take it? | How many times a day should I take it? |
| cascade-segment-controls | es-05 | My head has been hurting a lot since yesterday. | I have had a severe headache since yesterday. |
| cascade-segment-controls | es-06 | My daughter is allergic to penicillin. | My daughter is allergic to penicillin. |
| cascade-segment-controls | es-07 | Can I take this medication on an empty stomach? | Can I take this medication on an empty stomach? |
| cascade-segment-controls | es-08 | I have diabetes and I take insulin every morning. | I have diabetes and I take insulin every morning. |
| cascade-segment-controls | es-09 | The child fell and hurt his left arm. | The child fell and hurt his left arm. |
| cascade-segment-controls | es-10 | How long do I have to wait to see the doctor? | How long do I have to wait to see the doctor? |
| cascade-segment-controls | es-11 | I don't have health insurance, but I can pay in cash. | I do not have health insurance, but I can pay in cash. |
| cascade-segment-controls | es-12 | I need a new prescription because I ran out of the pills. | I need a new prescription because I ran out of the pills. |
| cascade-deepl-controls | en-01 | Mi hijo tiene fiebre desde anoche. | Mi hijo tiene fiebre desde anoche. |
| cascade-deepl-controls | en-02 | ¿Es alérgico a algún medicamento? | ¿Es alérgico a algún medicamento? |
| cascade-deepl-controls | en-03 | Necesito cambiar mi cita al viernes por la mañana. | Necesito cambiar mi cita al viernes por la mañana. |
| cascade-deepl-controls | en-04 | El dolor empezó después de comer y cada vez es más intenso. | El dolor comenzó después de comer y está empeorando. |
| cascade-deepl-controls | en-05 | Toma un comprimido dos veces al día con las comidas. | Tome una tableta dos veces al día con las comidas. |
| cascade-deepl-controls | en-06 | ¿Te has sometido a alguna intervención quirúrgica en los últimos cinco años? | ¿Se ha sometido a alguna cirugía en los últimos cinco años? |
| cascade-deepl-controls | en-07 | Hoy tienes la tensión arterial un poco alta. | Hoy su presión arterial es un poco alta. |
| cascade-deepl-controls | en-08 | Te llamaremos cuando estén listos los resultados de las pruebas. | Le llamaremos cuando estén listos los resultados de las pruebas. |
| cascade-deepl-controls | en-09 | ¿Te duele cuando respiras profundamente? | ¿Le duele al respirar profundamente? |
| cascade-deepl-controls | en-10 | Lleva dos semanas con tos y no puede dormir. | Lleva dos semanas con tos y no puede dormir. |
| cascade-deepl-controls | en-11 | No comas ni bebas nada a partir de la medianoche antes de la intervención. | No coma ni beba nada a partir de la medianoche antes del procedimiento. |
| cascade-deepl-controls | en-12 | ¿Cuál es tu fecha de nacimiento? | ¿Cuál es su fecha de nacimiento? |
| cascade-deepl-controls | es-01 | I have an appointment with the doctor at 3. | I have an appointment with the doctor at 3. |
| cascade-deepl-controls | es-02 | I don't understand the recipe instructions. | I don't understand the prescription instructions. |
| cascade-deepl-controls | es-03 | My wife needs an interpreter tomorrow. | My wife needs an interpreter tomorrow. |
| cascade-deepl-controls | es-04 | How many times a day should you take it? | How many times a day should you take it? |
| cascade-deepl-controls | es-05 | I've had a really bad headache since yesterday, | I've had a really bad headache since yesterday, |
| cascade-deepl-controls | es-06 | My daughter is allergic to penicillin. | My daughter is allergic to penicillin. |
| cascade-deepl-controls | es-07 | Can I take this medication on an empty stomach? | Can I take this medication on an empty stomach? |
| cascade-deepl-controls | es-08 | I have diabetes and take insulin every morning. | I have diabetes and take insulin every morning. |
| cascade-deepl-controls | es-09 | The boy fell and hurt his left arm. | The boy fell and hurt his left arm. |
| cascade-deepl-controls | es-10 | How long do I have to wait to see the doctor? | How long do I have to wait to see the doctor? |
| cascade-deepl-controls | es-11 | I don't have health insurance, but I can pay in cash. | I don't have health insurance, but I can pay in cash. |
| cascade-deepl-controls | es-12 | I need a new prescription because I ran out of pills. | I need a new prescription because I ran out of pills. |
