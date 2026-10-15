# Evaluation report

Generated 2026-10-15T06:45:28.708Z by `npm run report` from the latest harness run per configuration.
All numbers are measured; p50/p95 use linear interpolation. Clips are synthetic speech (ElevenLabs), 24 clinic sentences (12 EN, 12 ES).

| Configuration | Run file | Turns |
|---|---|---|
| Realtime (gpt-realtime) | `runs/realtime--2026-10-15T06-17-20-574Z.json` | 24 |
| Cascade · segment (Deepgram · OpenAI · ElevenLabs) | `runs/cascade-segment--2026-10-15T06-20-12-408Z.json` | 24 |
| Cascade · clause (Deepgram · OpenAI · ElevenLabs) | `runs/cascade-clause--2026-10-15T06-22-59-109Z.json` | 24 |
| Cascade · segment, DeepL primary (Deepgram · DeepL · ElevenLabs) | `runs/cascade-deepl--2026-10-15T06-28-44-737Z.json` | 24 |

## 1. Latency: mouth-to-ear (T0 = last voiced frame → first audible)

| Configuration | n ok | p50 | p95 | Target | p95 meets target | Access p50 / p95 |
|---|---|---|---|---|---|---|
| Realtime (gpt-realtime) | 24/24 | 0.89 s | 1.06 s | < 1.5 s | yes | 0.00 s / 0.00 s |
| Cascade · segment (Deepgram · OpenAI · ElevenLabs) | 24/24 | 1.41 s | 1.65 s | < 3.0 s | yes | 0.02 s / 0.03 s |
| Cascade · clause (Deepgram · OpenAI · ElevenLabs) | 24/24 | 1.20 s | 1.46 s | < 2.0 s (stretch) | yes | 0.02 s / 0.02 s |
| Cascade · segment, DeepL primary (Deepgram · DeepL · ElevenLabs) | 24/24 | 1.15 s | 1.22 s | < 3.0 s | yes | 0.02 s / 0.03 s |

Cascade target is < 3 s; the < 2 s stretch goal is shown against the clause configuration but applies to every cascade row.

### Stage breakdown (p50 / p95, ms after T0, completed turns)

| Configuration | Release | STT final | Translate 1st tok | TTS first byte | RT response start | First audible |
|---|---|---|---|---|---|---|
| Realtime (gpt-realtime) | 0.41 s / 0.42 s | hidden | hidden | hidden | 0.52 s / 0.56 s | 0.89 s / 1.06 s |
| Cascade · segment (Deepgram · OpenAI · ElevenLabs) | 0.41 s / 0.43 s | 0.58 s / 0.64 s | 1.03 s / 1.35 s | 1.30 s / 1.56 s | n/a | 1.41 s / 1.65 s |
| Cascade · clause (Deepgram · OpenAI · ElevenLabs) | 0.41 s / 0.43 s | 0.59 s / 0.63 s | 1.00 s / 1.15 s | 1.24 s / 1.39 s | n/a | 1.20 s / 1.46 s |
| Cascade · segment, DeepL primary (Deepgram · DeepL · ElevenLabs) | 0.41 s / 0.44 s | 0.58 s / 0.61 s | 0.90 s / 0.97 s | 1.05 s / 1.12 s | n/a | 1.15 s / 1.22 s |

Cascade stage marks are when the final segment's stage event reached the browser; a negative value means the stage finished during speech (consecutive playback pre-synthesized it). Realtime's internal stages are not observable and are never estimated.

### By direction (mouth-to-ear p50 / p95)

| Configuration | EN → ES | ES → EN |
|---|---|---|
| Realtime (gpt-realtime) | 0.87 s / 1.02 s | 0.91 s / 1.07 s |
| Cascade · segment (Deepgram · OpenAI · ElevenLabs) | 1.43 s / 1.93 s | 1.38 s / 1.50 s |
| Cascade · clause (Deepgram · OpenAI · ElevenLabs) | 1.22 s / 1.44 s | 1.16 s / 1.46 s |
| Cascade · segment, DeepL primary (Deepgram · DeepL · ElevenLabs) | 1.14 s / 1.23 s | 1.15 s / 1.22 s |

## 2. Quality

| Configuration | Source WER | Target WER vs reference (crude proxy) | Accuracy | Completeness | Fluency | Answered instead of interpreted |
|---|---|---|---|---|---|---|
| Realtime (gpt-realtime) | 0.000 (side transcription) | 0.114 | 4.96 | 4.96 | 4.96 | 0% (0/24) |
| Cascade · segment (Deepgram · OpenAI · ElevenLabs) | 0.000 | 0.061 | 4.96 | 5.00 | 5.00 | 0% (0/24) |
| Cascade · clause (Deepgram · OpenAI · ElevenLabs) | 0.000 | 0.088 | 4.83 | 4.88 | 4.71 | 0% (0/24) |
| Cascade · segment, DeepL primary (Deepgram · DeepL · ElevenLabs) | 0.000 | 0.293 | 4.96 | 5.00 | 4.96 | 0% (0/24) |

Rubric scores are 1-5 from an **automated judge** (gpt-4.1-mini, temperature 0) comparing each output with the source and the reference translation; spot-check them with the human sheet in MORNING.md.
Target WER against a single reference translation penalizes valid paraphrases, so it is a crude proxy. Realtime's source transcript comes from OpenAI's side transcription (gpt-4o-transcribe), not from what the speech-to-speech model understood.
"Answered instead of interpreted" = flagged by the heuristic (a question rendered as a statement, output > 1.8x the reference, or output in the wrong language) or by the judge. Flags are a review list, not a verdict.

## 3. Cost per minute of input speech

Logged usage per turn × `harness/pricing.json` (prices read 2026-10-15; marked "verify"; DeepL rate UNVERIFIED).

| Configuration | Speech minutes | Total USD | USD per minute |
|---|---|---|---|
| Realtime (gpt-realtime) | 1.17 | 0.2413 | 0.2054 |
| Cascade · segment (Deepgram · OpenAI · ElevenLabs) | 1.18 | 0.0510 | 0.0434 |
| Cascade · clause (Deepgram · OpenAI · ElevenLabs) | 1.18 | 0.0511 | 0.0435 |
| Cascade · segment, DeepL primary (Deepgram · DeepL · ElevenLabs) | 1.18 | 0.0775 | 0.0658 |

Speech minutes = press-to-release time of the turns. Realtime cost includes model audio/text tokens (input context re-billing included as logged) and side transcription; cascade = Deepgram minutes + translation tokens or characters + ElevenLabs characters.

## 4. Provider flexibility: OpenAI → DeepL translation swap

| | OpenAI (gpt-4.1-nano, streamed) | DeepL (no streaming) |
|---|---|---|
| Mouth-to-ear p50 / p95 | 1.41 s / 1.65 s | 1.15 s / 1.22 s |
| Translate first token, after T0 | 1.03 s / 1.35 s | 0.90 s / 0.97 s |
| Target WER (proxy) | 0.06 | 0.29 |
| Judge accuracy | 4.96 | 4.96 |

The swap is a configuration change only: the harness opens `/?providers=translation:deepl`; no code changed. The same is true server-side via `Providers:Translation` in appsettings.json.

## 5. Stability: 5-minute soak per mode

| Mode | Minutes | Turns | Failed turns | Unplanned disconnects | Forced-drop recovery (drop → Ready) | Transcript intact after drop | Heap floor, 1st min → last min | Heap raw start → end | Max playback buffer | Underruns |
|---|---|---|---|---|---|---|---|---|---|---|
| realtime | 5 | 45 | 0 | 0 | 2112 ms | yes | 12.6 MB → 17.5 MB | 12.6 MB → 33.2 MB | 0 ms | – |
| cascade | 5 | 45 | 0 | 0 | 1080 ms | yes | 12.4 MB → 16.1 MB | 12.4 MB → 16.1 MB | 4093 ms | 0 |

Unplanned disconnects excludes the one forced drop. Realtime plays through a media element, so its jitter buffer is the browser's and is not observable (0 / –). The cascade's max buffer is synthesized audio queued ahead of playback (TTS runs faster than real time); it drains to zero every turn.

## 6. Time to onboard a language pair

See [onboarding.md](onboarding.md).

## Appendix: every turn

| Config | Clip | Status | Mouth-to-ear | Source (as heard) | Target |
|---|---|---|---|---|---|
| realtime | en-01 | completed | 1.04 s | My son has had a fever since last night. | Mi hijo ha tenido fiebre desde anoche. |
| realtime | en-02 | completed | 0.94 s | Is he allergic to any medication? | ¿Es alérgico a algún medicamento? |
| realtime | en-03 | completed | 0.85 s | I need to move my appointment to Friday morning. | Necesito mover mi cita al viernes por la mañana. |
| realtime | en-04 | completed | 0.86 s | The pain started after lunch and it is getting worse. | El dolor empezó después del almuerzo y está empeorando. |
| realtime | en-05 | completed | 0.86 s | Please take one tablet twice a day with food. | Por favor, tome una tableta dos veces al día con comida. |
| realtime | en-06 | completed | 0.90 s | Have you had any surgery in the last five years? | ¿Ha tenido alguna cirugía en los últimos cinco años? |
| realtime | en-07 | completed | 0.84 s | Your blood pressure is a little high today. | Su presión arterial está un poco alta hoy. |
| realtime | en-08 | completed | 0.87 s | We will call you when the test results are ready. | Lo llamaremos cuando los resultados de las pruebas estén listos. |
| realtime | en-09 | completed | 0.88 s | Does it hurt when you breathe deeply? | ¿Le duele cuando respira hondo? |
| realtime | en-10 | completed | 0.85 s | She has been coughing for two weeks and cannot sleep. | Ha estado tosiendo durante dos semanas y no puede dormir. |
| realtime | en-11 | completed | 0.87 s | Do not eat or drink anything after midnight before the procedure. | No coma ni beba nada después de la medianoche antes del procedimiento. |
| realtime | en-12 | completed | 1.01 s | What is your date of birth? | ¿Cuál es su fecha de nacimiento? |
| realtime | es-01 | completed | 0.92 s | Tengo una cita a las tres con la doctora. | I have an appointment at three with the doctor. |
| realtime | es-02 | completed | 1.01 s | No entiendo las instrucciones de la receta. | I don’t understand the instructions of the recipe. |
| realtime | es-03 | completed | 1.09 s | Mi esposa necesita un intérprete mañana. | My spouse needs an interpreter tomorrow. |
| realtime | es-04 | completed | 0.87 s | ¿Cuántas veces al día debe tomarlo? | How many times a day should they take it? |
| realtime | es-05 | completed | 0.85 s | Me duele mucho la cabeza desde ayer. | I’ve had a really bad headache since yesterday. |
| realtime | es-06 | completed | 0.85 s | Mi hija es alérgica a la penicilina. | My daughter is allergic to penicillin. |
| realtime | es-07 | completed | 0.91 s | ¿Puedo tomar este medicamento con el estómago vacío? | Can I take this medication on an empty stomach? |
| realtime | es-08 | completed | 0.88 s | Tengo diabetes y tomo insulina todas las mañanas. | I have diabetes and I take insulin every morning. |
| realtime | es-09 | completed | 1.03 s | El niño se cayó y se lastimó el brazo izquierdo. | The child fell and hurt his left arm. |
| realtime | es-10 | completed | 1.06 s | ¿Cuánto tiempo tengo que esperar para ver al médico? | How long do I have to wait to see the doctor? |
| realtime | es-11 | completed | 0.93 s | No tengo seguro médico, pero puedo pagar en efectivo. | I don’t have health insurance, but I can pay in cash. |
| realtime | es-12 | completed | 0.90 s | Necesito una receta nueva porque se me acabaron las pastillas. | I need a new prescription because I’ve run out of my pills. |
| cascade-segment | en-01 | completed | 1.66 s | My son has had a fever since last night. | Mi hijo ha tenido fiebre desde anoche. |
| cascade-segment | en-02 | completed | 2.25 s | Is he allergic to any medication? | ¿Es alérgico a algún medicamento? |
| cascade-segment | en-03 | completed | 1.44 s | I need to move my appointment to Friday morning. | Necesito mover mi cita al viernes por la mañana. |
| cascade-segment | en-04 | completed | 1.22 s | The pain started after lunch and it is getting worse. | El dolor comenzó después del almuerzo y está empeorando. |
| cascade-segment | en-05 | completed | 1.54 s | Please take one tablet twice a day with food. | Por favor, tome una tableta dos veces al día con comida. |
| cascade-segment | en-06 | completed | 1.42 s | Have you had any surgery in the last five years? | ¿Ha tenido alguna cirugía en los últimos cinco años? |
| cascade-segment | en-07 | completed | 1.55 s | Your blood pressure is a little high today. | Tu presión arterial está un poco alta hoy. |
| cascade-segment | en-08 | completed | 1.35 s | We will call you when the test results are ready. | Le llamaremos cuando los resultados de la prueba estén listos. |
| cascade-segment | en-09 | completed | 1.42 s | Does it hurt when you breathe deeply? | ¿Le duele cuando respira profundamente? |
| cascade-segment | en-10 | completed | 1.21 s | She has been coughing for two weeks and cannot sleep. | Ella ha estado tosiendo durante dos semanas y no puede dormir. |
| cascade-segment | en-11 | completed | 1.47 s | Do not eat or drink anything after midnight before the procedure. | No coma ni beba nada después de la medianoche antes del procedimiento. |
| cascade-segment | en-12 | completed | 1.32 s | What is your date of birth? | ¿Cuál es su fecha de nacimiento? |
| cascade-segment | es-01 | completed | 1.33 s | Tengo una cita a las 3 con la doctora. | I have an appointment at 3 with the doctor. |
| cascade-segment | es-02 | completed | 1.37 s | No entiendo las instrucciones de la receta. | I don't understand the instructions on the prescription. |
| cascade-segment | es-03 | completed | 1.13 s | Mi esposa necesita un intérprete mañana. | My wife needs an interpreter tomorrow. |
| cascade-segment | es-04 | completed | 1.14 s | ¿Cuántas veces al día debe tomarlo? | How many times a day should I take it? |
| cascade-segment | es-05 | completed | 1.27 s | Me duele mucho la cabeza desde ayer, | My head has been hurting a lot since yesterday. |
| cascade-segment | es-06 | completed | 1.35 s | Mi hija es alérgica a la penicilina. | My daughter is allergic to penicillin. |
| cascade-segment | es-07 | completed | 1.38 s | ¿Puedo tomar este medicamento con el estómago vacío? | Can I take this medication on an empty stomach? |
| cascade-segment | es-08 | completed | 1.46 s | Tengo diabetes y tomo insulina todas las mañanas. | I have diabetes and I take insulin every morning. |
| cascade-segment | es-09 | completed | 1.41 s | El niño se cayó y se lastimó el brazo izquierdo. | The child fell and hurt his left arm. |
| cascade-segment | es-10 | completed | 1.53 s | ¿Cuánto tiempo tengo que esperar para ver al médico? | How long do I have to wait to see the doctor? |
| cascade-segment | es-11 | completed | 1.42 s | No tengo seguro médico, pero puedo pagar en efectivo. | I don't have health insurance, but I can pay in cash. |
| cascade-segment | es-12 | completed | 1.48 s | Necesito una receta nueva porque se me acabaron las pastillas. | I need a new prescription because I ran out of the pills. |
| cascade-clause | en-01 | completed | 1.31 s | My son has had a fever since last night. | Mi hijo ha tenido fiebre desde anoche. |
| cascade-clause | en-02 | completed | 1.47 s | Is he allergic to any medication? | ¿Es alérgico a algún medicamento? |
| cascade-clause | en-03 | completed | 1.35 s | I need to move my appointment to Friday morning. | Necesito mover mi cita al viernes por la mañana. |
| cascade-clause | en-04 | completed | 0.98 s | The pain started after lunch and it is getting worse. | El dolor comenzó después del almuerzo y está empeorando. |
| cascade-clause | en-05 | completed | 1.19 s | Please take one tablet twice a day with food. | Por favor, tome una tableta dos veces al día con comida. |
| cascade-clause | en-06 | completed | 1.42 s | Have you had any surgery in the last five years? | ¿Ha tenido alguna cirugía en los últimos cinco años? |
| cascade-clause | en-07 | completed | 1.21 s | Your blood pressure is a little high today. | Tu presión arterial está un poco alta hoy. |
| cascade-clause | en-08 | completed | 1.23 s | We will call you when the test results are ready. | Le llamaremos cuando los resultados de la prueba estén listos. |
| cascade-clause | en-09 | completed | 1.01 s | Does it hurt when you breathe deeply? | ¿Duele? ¿Cuando respira profundamente? |
| cascade-clause | en-10 | completed | 1.16 s | She has been coughing for two weeks and cannot sleep. | Ella ha estado tosiendo durante dos semanas y no puede dormir. |
| cascade-clause | en-11 | completed | 0.59 s | Do not eat or drink anything after midnight before the procedure. | No comas o beber algo después de la medianoche antes del procedimiento. |
| cascade-clause | en-12 | completed | 1.35 s | What is your date of birth? | ¿Cuál es su fecha de nacimiento? |
| cascade-clause | es-01 | completed | 1.39 s | Tengo una cita a las 3 con la doctora. | I have an appointment at 3 with the doctor. |
| cascade-clause | es-02 | completed | 1.41 s | No entiendo las instrucciones de la receta. | I don't understand the instructions on the prescription. |
| cascade-clause | es-03 | completed | 1.16 s | Mi esposa necesita un intérprete mañana. | My wife needs an interpreter tomorrow. |
| cascade-clause | es-04 | completed | 1.12 s | ¿Cuántas veces al día debe tomarlo? | How many times a day should I take it? |
| cascade-clause | es-05 | completed | 1.23 s | Me duele mucho la cabeza desde ayer, | My head has been hurting a lot since yesterday. |
| cascade-clause | es-06 | completed | 1.35 s | Mi hija es alérgica a la penicilina. | My daughter is allergic to penicillin. |
| cascade-clause | es-07 | completed | 1.14 s | ¿Puedo tomar este medicamento con el estómago vacío? | Can I take this medication on an empty stomach? |
| cascade-clause | es-08 | completed | 1.16 s | Tengo diabetes y tomo insulina todas las mañanas. | I have diabetes and I take insulin every morning. |
| cascade-clause | es-09 | completed | 0.91 s | El niño se cayó y se lastimó el brazo izquierdo. | The child fell down. and hurt his left arm. |
| cascade-clause | es-10 | completed | 1.52 s | ¿Cuánto tiempo tengo que esperar para ver al médico? | How long do I have to wait to see the doctor? |
| cascade-clause | es-11 | completed | 0.56 s | No tengo seguro médico, pero puedo pagar en efectivo. | I don't have health insurance. but I can pay in cash. |
| cascade-clause | es-12 | completed | 0.58 s | Necesito una receta nueva porque se me acabaron las pastillas. | I need a new prescription. because I ran out of the pills. |
| cascade-deepl | en-01 | completed | 1.15 s | My son has had a fever since last night. | Mi hijo tiene fiebre desde anoche. |
| cascade-deepl | en-02 | completed | 1.11 s | Is he allergic to any medication? | ¿Es alérgico a algún medicamento? |
| cascade-deepl | en-03 | completed | 1.11 s | I need to move my appointment to Friday morning. | Necesito cambiar mi cita al viernes por la mañana. |
| cascade-deepl | en-04 | completed | 1.22 s | The pain started after lunch and it is getting worse. | El dolor empezó después de comer y cada vez es más intenso. |
| cascade-deepl | en-05 | completed | 1.14 s | Please take one tablet twice a day with food. | Toma un comprimido dos veces al día con las comidas. |
| cascade-deepl | en-06 | completed | 1.24 s | Have you had any surgery in the last five years? | ¿Te has sometido a alguna intervención quirúrgica en los últimos cinco años? |
| cascade-deepl | en-07 | completed | 1.13 s | Your blood pressure is a little high today. | Hoy tienes la tensión arterial un poco alta. |
| cascade-deepl | en-08 | completed | 1.15 s | We will call you when the test results are ready. | Te llamaremos cuando estén listos los resultados de las pruebas. |
| cascade-deepl | en-09 | completed | 1.13 s | Does it hurt when you breathe deeply? | ¿Te duele cuando respiras profundamente? |
| cascade-deepl | en-10 | completed | 1.08 s | She has been coughing for two weeks and cannot sleep. | Lleva dos semanas con tos y no puede dormir. |
| cascade-deepl | en-11 | completed | 1.21 s | Do not eat or drink anything after midnight before the procedure. | No comas ni bebas nada a partir de la medianoche antes de la intervención. |
| cascade-deepl | en-12 | completed | 1.15 s | What is your date of birth? | ¿Cuál es tu fecha de nacimiento? |
| cascade-deepl | es-01 | completed | 1.13 s | Tengo una cita a las 3 con la doctora. | I have an appointment with the doctor at 3. |
| cascade-deepl | es-02 | completed | 1.12 s | No entiendo las instrucciones de la receta. | I don't understand the recipe instructions. |
| cascade-deepl | es-03 | completed | 1.16 s | Mi esposa necesita un intérprete mañana. | My wife needs an interpreter tomorrow. |
| cascade-deepl | es-04 | completed | 1.22 s | ¿Cuántas veces al día debe tomarlo? | How many times a day should you take it? |
| cascade-deepl | es-05 | completed | 1.21 s | Me duele mucho la cabeza desde ayer, | I've had a really bad headache since yesterday, |
| cascade-deepl | es-06 | completed | 1.17 s | Mi hija es alérgica a la penicilina. | My daughter is allergic to penicillin. |
| cascade-deepl | es-07 | completed | 1.08 s | ¿Puedo tomar este medicamento con el estómago vacío? | Can I take this medication on an empty stomach? |
| cascade-deepl | es-08 | completed | 1.20 s | Tengo diabetes y tomo insulina todas las mañanas. | I have diabetes and take insulin every morning. |
| cascade-deepl | es-09 | completed | 1.11 s | El niño se cayó y se lastimó el brazo izquierdo. | The boy fell and hurt his left arm. |
| cascade-deepl | es-10 | completed | 1.17 s | ¿Cuánto tiempo tengo que esperar para ver al médico? | How long do I have to wait to see the doctor? |
| cascade-deepl | es-11 | completed | 1.11 s | No tengo seguro médico, pero puedo pagar en efectivo. | I don't have health insurance, but I can pay in cash. |
| cascade-deepl | es-12 | completed | 1.14 s | Necesito una receta nueva porque se me acabaron las pastillas. | I need a new prescription because I ran out of pills. |
