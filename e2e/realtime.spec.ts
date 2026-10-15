import { expect, test } from "@playwright/test";
import { hasKey, missingKeyMessage } from "../scripts/env.mjs";
import { replayTurn, waitReady } from "./helpers";

// M2 acceptance: an EN clip through gpt-realtime over WebRTC produces Spanish audio and transcripts,
// with marks recorded. Uses Chromium's fake media device to grant the mic; the clip itself goes
// through the app's Replay input (same capture path, press/release automated). Costs a few cents.
test.describe("Realtime mode (gpt-realtime over WebRTC)", () => {
  test.skip(!hasKey("OpenAI__ApiKey"), missingKeyMessage("OpenAI__ApiKey"));

  test("EN clip -> Spanish audio and transcripts, first_audible recorded", async ({ page }) => {
    await page.goto("/?mode=realtime");
    await waitReady(page);
    await expect(page.getByTestId("connection-pill")).toHaveText(/WebRTC connected/);

    const turn = await replayTurn(page, "fixture-en-fever", "en", 60_000);

    expect(turn.status).toBe("completed");
    expect(turn.conditions).toMatchObject({ mode: "realtime", direction: "en-es" });
    expect(turn.targetText.length).toBeGreaterThan(5);
    // Spanish, not English: a crude but useful check on the interpreted text.
    expect(turn.targetText.toLowerCase()).toMatch(/fiebre|hijo|anoche/);
    for (const name of ["press", "access", "t0", "release", "rtResponseStart", "firstAudible"]) {
      expect(turn.marks[name], `mark ${name}`).toBeGreaterThan(0);
    }
    expect(turn.marks.firstAudible).toBeGreaterThan(turn.marks.release);
    const m = turn.marks;
    console.log(
      `realtime: mouth-to-ear ${(m.firstAudible - m.t0).toFixed(0)} ms, release->response ${(m.rtResponseStart - m.release).toFixed(0)} ms, ` +
        `access ${(m.access - m.press).toFixed(0)} ms | "${turn.targetText}"`,
    );
    // The source transcript (side transcription) may arrive after the audio; wait for it.
    await expect(page.getByTestId("source-text").first()).toContainText(/fever/i, { timeout: 20_000 });
    await expect(page.getByTestId("target-text").first()).toBeVisible();
  });
});
