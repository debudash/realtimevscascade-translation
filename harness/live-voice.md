# Live-voice session

Complements the synthetic clips (planning decision D-24): a person speaks
six of the same clinic sentences into the microphone in each mode, so the
results can be compared line by line with the synthetic runs. It takes
about 10 minutes and costs a few cents.

**English only.** The session covers English to Spanish. Spanish to English
stays measured on the synthetic clips only, because no Spanish speaker was
available; the results say so.

## Before you start

1. `npm run dev`, open http://localhost:5173 in Chrome, allow the
   microphone. Use headphones so the interpretation does not reach the mic.
2. Leave **Input** on Microphone and **Clinic terms** on Off (the synthetic
   baseline was measured with the controls off).

## Script

Hold the speaker's button, read the line at a normal pace, release. Wait
for the interpretation to finish before the next line.

All lines use the **English speaker** button.

| # | Say | Clip id | Why this line |
|---|---|---|---|
| 1 | My son has had a fever since last night. | en-01 | short statement |
| 2 | The pain started after lunch, and it is getting worse. | en-04 | two clauses (commit policy) |
| 3 | Please take one tablet twice a day with food. | en-05 | dosage instruction |
| 4 | Your blood pressure is a little high today. | en-07 | short statement |
| 5 | Does it hurt when you breathe deeply? | en-09 | question: must be interpreted, not answered |
| 6 | Do not eat or drink anything after midnight before the procedure. | en-11 | longest line, several segments |

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
