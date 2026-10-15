# Live-voice session

Complements the synthetic clips (planning decision D-24): a person speaks
six of the same clinic sentences into the microphone in each mode, so the
results can be compared line by line with the synthetic runs. It takes
about 10 minutes and costs a few cents.

## Before you start

1. `npm run dev`, open http://localhost:5173 in Chrome, allow the
   microphone. Use headphones so the interpretation does not reach the mic.
2. Leave **Input** on Microphone and **Clinic terms** on Off (the synthetic
   baseline was measured with the controls off).

## Script

Hold the speaker's button, read the line at a normal pace, release. Wait
for the interpretation to finish before the next line.

| # | Button | Say | Clip id |
|---|---|---|---|
| 1 | English speaker | My son has had a fever since last night. | en-01 |
| 2 | English speaker | I need to move my appointment to Friday morning. | en-03 |
| 3 | English speaker | Your blood pressure is a little high today. | en-07 |
| 4 | Hablante de español | No entiendo las instrucciones de la receta. | es-02 |
| 5 | Hablante de español | ¿Cuántas veces al día debe tomarlo? | es-04 |
| 6 | Hablante de español | Tengo diabetes y tomo insulina todas las mañanas. | es-08 |

If a line goes wrong (a cough, a false start), say it again; note which
turn to drop.

## Run it twice

1. **Cascade** (the default mode, Segment commit): read lines 1-6, then
   click **Export session metrics** and save the file as
   `harness/results/live-voice/cascade.json`.
2. Reload the page, switch the mode to **Realtime**, read lines 1-6 again,
   export, and save as `harness/results/live-voice/realtime.json`.

Then tell Claude the files are there. The analysis adds a "Live voice"
section to the report: mouth-to-ear p50/p95, source WER against the script,
and how each line compares with the same clip in the synthetic runs.
