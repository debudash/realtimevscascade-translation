// Language-pair onboarding exercise: EN <-> FR, added by configuration only (appsettings.json
// Languages + Pairs) plus 2 clips per direction. Runs the 4 clips through Realtime and Cascade with
// the pair selected in the UI and saves harness/results/onboarding-runs.json.
//   npx playwright test -c harness/playwright.harness.config.ts onboarding.harness.ts
import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { replayTurn, waitReady } from "../e2e/helpers";
import { ensureDir, loadScripts, resultsDir } from "./lib";

test("onboarding: EN <-> FR through both architectures", async ({ page }) => {
  const clips = loadScripts().clips.filter((c) => c.pair === "en-fr");
  const results: Record<string, unknown[]> = {};
  for (const [mode, url] of [
    ["realtime", "/?mode=realtime"],
    ["cascade-segment", "/"],
  ] as const) {
    await page.goto(url);
    await waitReady(page);
    await page.getByTestId("pair-select").selectOption("en-fr");
    await waitReady(page);
    await expect(page.getByTestId("talk-fr")).toBeVisible();
    results[mode] = [];
    for (const clip of clips) {
      const turn = await replayTurn(page, clip.id, clip.lang, 60_000);
      results[mode].push({ clipId: clip.id, ...turn });
      console.log(`${mode} ${clip.id}: ${turn.status} ${((turn.marks.firstAudible - turn.marks.t0) / 1000).toFixed(2)} s | ${turn.sourceText} -> ${turn.targetText}`);
    }
  }
  ensureDir(resultsDir);
  writeFileSync(join(resultsDir, "onboarding-runs.json"), JSON.stringify({ finishedAt: new Date().toISOString(), results }, null, 2));
});
