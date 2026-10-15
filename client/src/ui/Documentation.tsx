// Documentation tab: a plain how-to for testers using the workbench. Labels match the UI.

export function Documentation() {
  return (
    <article className="panel doc" aria-label="How to use the workbench">
      <h2 className="doc__title">How to use the workbench</h2>
      <p>
        The workbench interprets a short clinic conversation between an English speaker and a Spanish speaker, using one of two
        architectures, and measures how long each takes. <b>Realtime</b> sends your voice to OpenAI&apos;s speech-to-speech model.{" "}
        <b>Cascade</b> chains three services: speech-to-text, translation and text-to-speech.
      </p>

      <section>
        <h3>Before you start</h3>
        <ul>
          <li>
            Wait for the status line on the left to say <b>Ready</b>. Until then the talk buttons show &quot;Not ready&quot; while the
            connection warms up. The pill in the header shows the connection (WebRTC for Realtime, WebSocket for Cascade).
          </li>
          <li>Use headphones with the microphone, so the interpretation is not picked up again.</li>
          <li>
            In the header, choose the <b>mode</b> (Realtime or Cascade), the <b>language pair</b> and the <b>input</b>: Microphone, or
            Replay with one of the recorded clinic sentences.
          </li>
          <li>
            Cascade only: <b>Segment</b> or <b>Clause</b> sets how early translation starts. Segment waits for each finished phrase;
            Clause starts at natural breaks and is usually faster.
          </li>
          <li>
            <b>Clinic terms</b> asks for formal address (usted) and the clinic glossary (for example, &quot;receta&quot; is translated as
            &quot;prescription&quot;). Turn it Off to hear the plain translation.
          </li>
        </ul>
      </section>

      <section>
        <h3>Interpret a conversation</h3>
        <ol>
          <li>
            Each speaker has a button bound to their language: <b>English speaker</b> (English to Spanish) and{" "}
            <b>Hablante de español</b> (Spanish to English).
          </li>
          <li>
            <b>Hold</b> your button while you speak (or focus it and hold Space), then <b>release</b>. The interpretation plays after
            you release. With a Replay input, click the button once: the clip plays and the button releases itself.
          </li>
          <li>
            One turn at a time. If the other speaker presses while a turn is running, they hear a short two-note tone and see
            &quot;Floor busy&quot;; they press again when it finishes.
          </li>
          <li>
            You can switch mode at any time. During a turn the switch waits until the turn ends; the banner offers &quot;Stay on&quot;
            and the current mode&apos;s name to undo it.
          </li>
        </ol>
      </section>

      <section>
        <h3>Read the measurements</h3>
        <ul>
          <li>
            <b>Live transcripts</b> show what was said and the interpretation as they arrive, newest first, with the mode, direction,
            providers, Clinic terms setting and &quot;first audio&quot; time. The latest four show; scroll the list for earlier turns.
          </li>
          <li>
            <b>Speech end → first audible</b> is the headline number: from the moment you stopped speaking (not when you released) to
            the first sound of the interpretation. The bars below break it into stages. Realtime&apos;s inner stages are shown as
            &quot;hidden&quot; because OpenAI does not expose them.
          </li>
          <li>
            <b>Session p50 / p95</b> summarizes every completed turn per mode against its target: under 1.5 s for Realtime, under 3 s
            for Cascade (2 s for Clause). Green is under target, red over.
          </li>
          <li>
            <b>Export session metrics</b> downloads every turn of this session as JSON, with its timings and settings.
          </li>
        </ul>
      </section>

      <section>
        <h3>Compare Realtime and Cascade</h3>
        <ol>
          <li>Choose a Replay input, for example &quot;Replay: en-03&quot;, and run a turn.</li>
          <li>Switch the mode in the header and run the same input again.</li>
          <li>
            The <b>Compare modes</b> row under the transcripts shows the latest turn of each mode side by side: the headline time and
            the difference, access time, release lag, the stages, the turn&apos;s cost, and the text. A note says whether both used
            the same input.
          </li>
        </ol>
      </section>

      <section>
        <h3>Run a test run</h3>
        <p>A test run plays a set of replay clips on one setup and keeps the results, so you can repeat a measurement and compare.</p>
        <ol>
          <li>
            Open the <b>Test Runs</b> tab and give the run a name.
          </li>
          <li>
            Pick one <b>setup</b>: Realtime, Cascade · segment, Cascade · clause or Cascade · DeepL; then Clinic terms On or Off.
          </li>
          <li>
            Choose the <b>utterances</b> (all, English, Spanish, or pick clips) and the number of <b>passes</b> (1-3).
          </li>
          <li>
            Check the estimate (turns, minutes, cost), click <b>Start</b>, then <b>Start run</b> to confirm. The header controls lock
            while it runs; <b>Cancel</b> stops after the current turn and keeps what ran.
          </li>
          <li>
            Saved runs appear on the right. Click a name to see every turn and <b>Export JSON</b>. Tick two runs and click{" "}
            <b>Compare selected</b> to see them side by side, clip by clip.
          </li>
        </ol>
        <p className="secondary">Runs are saved in the project folder under harness/results/test-runs/.</p>
      </section>

      <section>
        <h3>When something goes wrong</h3>
        <dl className="doc__errors">
          <dt>Microphone access is blocked</dt>
          <dd>Allow the microphone in the browser&apos;s site settings and click Try again, or click Use replay clips.</dd>
          <dt>Configuration missing</dt>
          <dd>An API key is missing. Add the named variable to the .env file in the project folder and restart the app.</dd>
          <dt>Connection lost. Reconnecting</dt>
          <dd>The app retries up to five times. Transcripts are kept. If it fails, reload the page.</dd>
          <dt>Timed out, Provider error or Rate limited on a turn</dt>
          <dd>One service did not answer in time or refused the request. Click Retry turn to send the same audio again.</dd>
          <dt>Translation provider busy</dt>
          <dd>OpenAI translation was rate limited, so the turn switched to DeepL. It is noted on the turn.</dd>
          <dt>No speech detected</dt>
          <dd>Hold the button for the whole time you speak, and check the input.</dd>
        </dl>
      </section>

      <section>
        <h3>Terms</h3>
        <dl className="doc__terms">
          <dt>T0</dt>
          <dd>The end of your speech, taken from the last voiced audio frame.</dd>
          <dt>Mouth-to-ear</dt>
          <dd>T0 to the first audible interpreted sound: the headline latency.</dd>
          <dt>Access time</dt>
          <dd>Button press to the first audio accepted by the app.</dd>
          <dt>Release lag</dt>
          <dd>How long the button was held after you stopped speaking.</dd>
          <dt>p50 / p95</dt>
          <dd>The median, and the time 95% of turns stay under.</dd>
          <dt>WER</dt>
          <dd>Word error rate: the share of words that differ from the expected text. For the interpretation it is a rough guide, since many translations are correct.</dd>
        </dl>
        <p className="secondary">
          Developers: add <code>?providers=fake</code> to the address to try everything without API cost, <code>?mode=realtime</code>{" "}
          to start in Realtime, or <code>?controls=off</code> to start with Clinic terms off.
        </p>
      </section>
    </article>
  );
}
