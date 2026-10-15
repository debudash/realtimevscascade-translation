# UI spec

The approved design is in `docs/design/`. This spec is the build reference.
Where the two differ, follow this spec. The design files are prototype HTML
from a design tool: use them for layout, copy, and colors, but do not copy
their templating syntax (`{{...}}`, `<sc-if>`, `<sc-for>`, `DCLogic`).

## Visual language

- **Ground:** `#F5F8FF`. Surfaces: `#FFFFFF`, with a 1px `#DFE9FD` border and
  10-16px radius. Ink: `#252224` (body), `#051E4D` (headings), `#54595F`
  (secondary).
- **Mode accents:** Realtime `#1462F0`, Cascade `#DD3900`. Speaker stage panel
  `#051E4D`, with teal `#82C5BF` for active controls.
- **Type:** Helvetica Neue / Arial stack for UI; IBM Plex Mono (Google Fonts)
  for labels, numbers, and tags.
- **Logo:** `boostlingo-logo.png` in the header (152x28), followed by a 1px
  divider and the title "Interpreter Workbench". Subtitle: "Candidate
  take-home · not an official Boostlingo product · N turns this session".
- **Accessibility:**
  - Touch targets at least 44px. Real `<button>` and `<select>` elements.
  - Text contrast 4.5:1.
  - Respect `prefers-reduced-motion`.
  - Talk buttons: Space and Enter press and hold.

## Layout (one page, responsive)

**Header (wraps on narrow screens):** logo + title on the left. On the right:

- Mode toggle (Realtime | Cascade)
- Commit toggle (Segment | Clause; dimmed in Realtime mode)
- Clinic terms toggle (Clinic terms | Off): formal register + clinic
  glossary, both modes, changeable between turns (re-warms). Default from
  config; `?controls=on|off` sets the initial value. Added after the build
  (D-23 change); see `docs/translation-controls.md`.
- Pair selector (English ↔ Spanish)
- Input selector (Microphone | Replay: each cached clip)
- Connection pill ("WebRTC connected" / "WebSocket connected" /
  "Reconnecting")

**Warm-up:** on page load and after a mode switch, the connection pill shows
"Connecting" and both talk buttons show "Not ready" (disabled styling) until
the transport and providers are warm.

**Realtime source transcript:** it may arrive after the interpreted audio.
Show it when it arrives, and never hold back the target text.

**Pending switch banner** (when a switch is queued): "Switching to {mode}
after this turn finishes playing. Transcripts are kept." with a button: "Stay
on {current}".

**Three columns on desktop:**

1. **Speaker stage** (dark panel):
   - Label "ENGLISH ↔ ESPAÑOL".
   - Two round talk buttons side by side, each 140px with a label beneath:
     - "English speaker", EN → ES
     - "Hablante de español", ES → EN
   - Button states:
     - Idle: teal, "Hold to talk"
     - Listening: teal, scaled 1.06, pulsing rings, timer
     - Owner while interpreting: dark with spinner, "Interpreting"
     - Owner while playing: "Playing"
     - Other speaker while busy: dim, "Wait"
     - Denied: shake, salmon ring `#FFB4A1`, "Floor busy" for ~1.4 s, plus
       the deny tone
   - Below the buttons: an audio level bar, then a status line (aria-live):
     - "Ready. Each speaker holds their own button."
     - "Listening · 2.3 s"
     - "Interpreting · Translate"
     - "Playing interpretation · capture muted"
     - "Floor busy · wait for the interpretation to finish"
   - Pipeline chips:
     - Realtime: Capture, gpt-realtime · internals not visible (dashed),
       Playing
     - Cascade: Capture, STT, Commit, Translate, TTS, Playing
     - The active chip is highlighted.
2. **Live transcripts**, newest first. The list shows the latest four cards
   (the live card counts as one) and scrolls for earlier turns; the header
   then reads "latest 4 of N · scroll for earlier". Added after the build at
   the owner's request.
   - **Live turn card:** mode tag, direction, a LIVE blink. Source text shows
     stable words in normal ink and partial words in grey. Target text
     streams with a caret.
   - **Completed turn cards:**
     - tag ("REALTIME" or "CASCADE · SEGMENT/CLAUSE")
     - direction
     - a badge with "first audio X.XX s"
     - source and target text
     - the providers used (e.g. "Deepgram · OpenAI · ElevenLabs" or
       "gpt-realtime")
     - a failover note if one occurred
     - the translation controls used: "Clinic terms on" or "Clinic terms off"
3. **Latency panel** (right column):
   - **"Session p50 / p95" table:**
     - columns: Mode, n, p50, p95, Target
     - rows: Realtime (< 1.5 s), Cascade · segment (< 3.0 s), Cascade · clause
       (< 2.0 s)
     - the Target cell is green when p95 is under target, red when over
   - **"Export session metrics" button:** downloads JSON of all turns, marks,
     and run conditions.
4. **"Compare modes" row** (full width under the columns; added after the
   build, replacing the single "Last turn" card, see decisions C-22):
   - two blocks side by side, Realtime and Cascade, each showing that mode's
     latest completed turn (final segment from T0); one column on phones
   - each block: mode tag, the input ("Microphone" or "Replay: en-03"),
     direction, the headline "speech end → first audible" with the
     difference to the other mode, then Access time, Release lag, Release →
     first audible, Segments committed (cascade), Turn cost and the per-minute
     equivalent (logged usage × `harness/pricing.json`)
   - waterfall rows on a shared axis:
     - Realtime: Release, Response start, STT / LLM / TTS (dashed track,
       "hidden"), First audible
     - Cascade: Release, STT final, Translate 1st tok, Translate done, TTS
       first byte, First audible
   - the turn's source and interpreted text and the providers used
   - a note above the blocks: "Same input in both" or "Different inputs",
     naming both inputs; a mode with no turn yet says how to fill it

## Test Runs tab (added after the build, decisions C-23)

Under the header, two tabs: **Workbench** (everything above) and **Test
Runs**. The open tab is kept in the URL hash (`#test-runs`).

- **New test run** (left):
  - Name (defaults to "Test run" plus date and time).
  - Setup, exactly one: Realtime, Cascade · segment, Cascade · clause,
    Cascade · DeepL, each with its providers.
  - Clinic terms: On or Off.
  - Utterances: All, English, Spanish, or Pick clips (a checklist of the
    replay clips with their text).
  - Passes: 1-3.
  - Estimate line: turns, voiced minutes, about how long, and about how
    much (press-to-release minutes × the measured cost per minute from
    `harness/results/cost-per-minute.json`; "fake providers, no API cost"
    when the session uses fakes).
  - Start, then an in-page confirmation naming the turns, setup and cost.
  - While running: a progress bar ("3 of 12 · Replay: en-03") and Cancel
    (stops after the turn in progress and saves what ran, marked
    cancelled). The header's setup controls are disabled until it ends.
  - Result line: "Saved: {name}" or "Not saved: {reason}".
- **Saved test runs** (right): newest first; name, setup and Clinic terms,
  turns, p50, p95 (green under the setup's target, red over), cost, date.
  A checkbox per row; "Compare selected" needs exactly two.
- **Detail** (opening a name): summary (mouth-to-ear p50 / p95 vs target,
  turns completed, access p50, release to first audible p50, source and
  target WER, cost and per minute), every turn (clip, status,
  mouth-to-ear, access, source, interpretation), Export JSON.
- **Compare**: the two summaries side by side, then per clip the mean
  mouth-to-ear of each run and B minus A.
- Runs are saved by the backend to `harness/results/test-runs/<id>.json`.

## Error and transition states (one per error code)

- **`mic_denied`:** a blocking panel, "Microphone access is blocked", with
  "Use replay clips" and "Try again" buttons.
- **`socket_drop`:** a banner, "Connection lost. Reconnecting, attempt n of
  5". The talk buttons are disabled, the turn in progress is cancelled, and
  transcripts are kept.
- **`provider_timeout`:** inline on the turn card, "Timed out at translation /
  No first token within 2.0 s after one retry", with a "Retry turn" button.
- **`rate_limited`:** a toast, "Translation provider busy / Got 429 three
  times. Switched to DeepL for 60 s. This is recorded on the turn."
  When the stage has no fallback (TTS, or translation without a DeepL key),
  the turn fails inline like the timeout row: "Rate limited at {stage}
  (HTTP 429)" with "Retry turn".
- **`empty_result`:** neutral, not an error. "No speech detected. Hold the
  button while you talk."
- **`config_error`:** a startup panel, "Configuration missing", listing the
  missing variable names, with "Add these to .env in the project folder,
  then restart the app."
- **`provider_error`:** same as the timeout row, but with the HTTP status.
- **`internal`:** a generic message with the turnId.
- **`floor_denied`:** see the button states above.

## Example clinic sentences (seed for harness/scripts.json)

**EN:**
- My son has had a fever since last night.
- Is he allergic to any medication?
- I need to move my appointment to Friday morning.
- The pain started after lunch, and it is getting worse.

**ES:**
- Tengo una cita a las tres con la doctora.
- No entiendo las instrucciones de la receta.
- Mi esposa necesita un intérprete mañana.
- ¿Cuántas veces al día debe tomarlo?
