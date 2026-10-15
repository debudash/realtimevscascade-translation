// Runs every evaluation clip through each configuration on real providers and saves the turns
// (marks, texts, usage, run conditions) to harness/results/runs/<config>--<timestamp>.json.
//   npx playwright test -c harness/playwright.harness.config.ts run.harness.ts
//   HARNESS_CONFIGS=realtime,cascade-segment  limits the configurations.
// Guardrail: refuses a 4th run of a configuration (CLAUDE.md cost guardrails).
import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { hasKey } from "../scripts/env.mjs";
import { replayTurn, waitReady } from "../e2e/helpers";
import { ALL_CONFIGS as CONFIGS, MAX_RUNS_PER_CONFIG, ensureDir, loadScripts, runsDir, runsFor, stamp } from "./lib";

// Default: the four baseline configurations. Control configurations run only when named.
const selected = (process.env.HARNESS_CONFIGS ?? "realtime,cascade-segment,cascade-clause,cascade-deepl").split(",").map((s) => s.trim());
const clipFilter = process.env.HARNESS_CLIPS?.split(",");
const NEEDS: Record<string, string[]> = {
  realtime: ["OpenAI__ApiKey"],
  "cascade-segment": ["Deepgram__ApiKey", "OpenAI__ApiKey", "ElevenLabs__ApiKey"],
  "cascade-clause": ["Deepgram__ApiKey", "OpenAI__ApiKey", "ElevenLabs__ApiKey"],
  "cascade-deepl": ["Deepgram__ApiKey", "DeepL__ApiKey", "ElevenLabs__ApiKey"],
  "realtime-controls": ["OpenAI__ApiKey"],
  "cascade-segment-controls": ["Deepgram__ApiKey", "OpenAI__ApiKey", "ElevenLabs__ApiKey"],
  "cascade-deepl-controls": ["Deepgram__ApiKey", "DeepL__ApiKey", "ElevenLabs__ApiKey"],
};

for (const config of selected) {
  test(`harness: ${config}`, async ({ page, browserName }) => {
    const missing = NEEDS[config].filter((k) => !hasKey(k));
    test.skip(missing.length > 0, `Skipped: ${missing.join(", ")} not set in .env`);
    const done = runsFor(config).length;
    test.skip(done >= MAX_RUNS_PER_CONFIG, `Cost guardrail: ${config} already has ${done} runs (max ${MAX_RUNS_PER_CONFIG}).`);

    const clips = loadScripts().clips.filter((c) => !c.pair && (!clipFilter || clipFilter.includes(c.id)));
    await page.goto(CONFIGS[config].url);
    await waitReady(page);

    const turns = [];
    const startedAt = new Date().toISOString();
    let reloads = 0;
    for (const clip of clips) {
      let turn = await replayTurn(page, clip.id, clip.lang, 60_000);
      if (!turn) {
        // The page reloaded (session reset): wait for Ready and retry this clip once.
        reloads++;
        await waitReady(page);
        turn = await replayTurn(page, clip.id, clip.lang, 60_000);
      }
      turns.push({ clipId: clip.id, ...turn });
      console.log(`${config} ${clip.id}: ${turn.status} ${((turn.marks.firstAudible - turn.marks.t0) / 1000).toFixed(2)} s | ${turn.targetText}`);
      await page.waitForTimeout(300);
    }

    ensureDir(runsDir);
    const file = join(runsDir, `${config}--${stamp()}.json`);
    writeFileSync(file, JSON.stringify({ config, label: CONFIGS[config].label, startedAt, finishedAt: new Date().toISOString(), browser: browserName, pageReloads: reloads, turns }, null, 2));
    console.log(`Saved ${turns.length} turns to ${file}`);
    expect(turns.length).toBe(clips.length);
  });
}
