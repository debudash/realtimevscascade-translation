import { expect, test } from "@playwright/test";
import { hasKey, missingKeyMessage } from "../scripts/env.mjs";
import { replayTurn, turns, waitReady } from "./helpers";

// M5 acceptance: a manual-equivalent walkthrough of both modes and a mid-turn mode switch.
// Cascade uses server-side fakes (no cost); the Realtime leg uses gpt-realtime (~1 cent).
test.describe("UI walkthrough", () => {
  test("cascade turn fills transcripts, latency panel and p50/p95; strategy switch; export", async ({ page }) => {
    await page.goto("/?providers=fake");
    await waitReady(page);

    await replayTurn(page, "en-01", "es" === "es" ? "en" : "en");
    const card = page.getByTestId("turn-card").first();
    await expect(card).toContainText("CASCADE · SEGMENT");
    await expect(card).toContainText("EN → ES");
    await expect(card).toContainText(/first audio \d\.\d\d s/);
    await expect(card).toContainText("Fake · Fake · Fake");
    await expect(card.getByTestId("controls-tag")).toHaveText("Clinic terms on");
    // Run conditions trace each turn to its session (runId) and the server's build commit.
    const health = await (await page.request.get("/api/health")).json();
    const [first] = await turns(page);
    expect(first.conditions.runId).toMatch(/^[0-9a-f]{8}$/);
    expect(first.conditions.build).toBe(health.build);
    // Mode comparison: one block per mode, each showing the latest turn of that mode and its input.
    const cascadeBlock = page.getByTestId("compare-cascade");
    await expect(cascadeBlock.getByTestId("headline-latency")).toHaveText(/\d\.\d\d s/);
    await expect(cascadeBlock).toContainText("Replay: en-01");
    await expect(cascadeBlock.getByTestId("waterfall")).toContainText("TTS first byte");
    await expect(cascadeBlock.getByTestId("waterfall")).toContainText("Translate done");
    await expect(cascadeBlock).toContainText("Release lag");
    await expect(cascadeBlock).toContainText("Fake · Fake · Fake");
    await expect(cascadeBlock.getByTestId("turn-cost")).toHaveText(/\$\d\.\d{4}/);
    await expect(page.getByTestId("compare-realtime")).toContainText("No Realtime turn yet");
    await expect(page.locator('[data-key="cascade-segment"] td').nth(1)).toHaveText("1");

    // Commit policy switch between turns.
    await page.getByTestId("commit-toggle").getByRole("button", { name: "Clause" }).click();
    await waitReady(page);
    const clause = await replayTurn(page, "es-01", "es");
    expect(clause.conditions).toMatchObject({ strategy: "clause", direction: "es-en" });
    await expect(page.getByTestId("turn-card").first()).toContainText("CASCADE · CLAUSE");
    await expect(page.locator('[data-key="cascade-clause"] td').nth(1)).toHaveText("1");

    // Clinic terms (translation controls) switch between turns; the turn records it.
    await page.getByTestId("controls-toggle").getByRole("button", { name: "Off" }).click();
    await waitReady(page);
    const off = await replayTurn(page, "en-02", "en");
    expect(off.conditions).toMatchObject({ controls: false });
    await expect(page.getByTestId("turn-card").first().getByTestId("controls-tag")).toHaveText("Clinic terms off");

    // Export downloads JSON of all turns with marks and run conditions.
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-metrics").click()]);
    const body = JSON.parse(await (await download.createReadStream())!.toArray().then((c) => Buffer.concat(c).toString()));
    expect(body.turns).toHaveLength(3);
    expect(body.turns[0].marks.press).toBeGreaterThan(0);
    expect(body.turns[1].conditions.strategy).toBe("clause");
    expect(body.turns[2].conditions.controls).toBe(false);
  });

  test("mode switch mid-turn is queued, then Realtime runs a turn, then back to Cascade", async ({ page }) => {
    test.skip(!hasKey("OpenAI__ApiKey"), missingKeyMessage("OpenAI__ApiKey"));
    await page.goto("/?providers=fake");
    await waitReady(page);

    await page.getByTestId("input-select").selectOption("en-03");
    await waitReady(page);
    await page.getByTestId("talk-en").click();
    await expect(page.getByTestId("talk-en")).toHaveAttribute("data-visual", "listening");

    // Mid-turn: the switch is queued with a banner and an escape hatch.
    await page.getByTestId("mode-toggle").getByRole("button", { name: "Realtime" }).click();
    await expect(page.getByTestId("pending-switch")).toContainText("Switching to Realtime after this turn finishes playing.");
    await expect(page.getByTestId("pending-switch").getByRole("button")).toHaveText("Stay on Cascade");

    // The turn finishes on Cascade; then the switch applies and Realtime warms up.
    await expect(page.getByTestId("connection-pill")).toHaveText(/WebRTC connected/, { timeout: 45_000 });
    await expect(page.getByTestId("pending-switch")).toBeHidden();
    const [first] = (await turns(page)).slice(-1);
    expect(first.conditions).toMatchObject({ mode: "cascade" });
    await expect(page.getByTestId("commit-toggle").getByRole("button").first()).toBeDisabled();

    const rt = await replayTurn(page, "es-04", "es", 60_000);
    expect(rt.status).toBe("completed");
    expect(rt.conditions).toMatchObject({ mode: "realtime", direction: "es-en" });
    await expect(page.getByTestId("turn-card").first()).toContainText("REALTIME");
    const realtimeBlock = page.getByTestId("compare-realtime");
    await expect(realtimeBlock).toContainText("Replay: es-04");
    await expect(realtimeBlock.getByTestId("waterfall")).toContainText("hidden");
    await expect(realtimeBlock).toContainText("gpt-realtime");
    await expect(realtimeBlock.getByTestId("turn-cost")).toHaveText(/\$\d\.\d{4}/);
    // The cascade block keeps its own latest turn, and the different inputs are called out.
    await expect(page.getByTestId("compare-cascade")).toContainText("Replay: en-03");
    await expect(page.getByTestId("compare-note")).toContainText("Different inputs");
    // The jitter buffer is the browser's, but WebRTC getStats() gives its average delay and concealment per turn.
    await expect
      .poll(async () => (await turns(page)).find((t) => t.turnId === rt.turnId)?.playback, { timeout: 10_000 })
      .toMatchObject({ jitterBufferMs: expect.any(Number), concealedPct: expect.any(Number), packetsLost: expect.any(Number) });
    await expect(page.locator(".chip--hidden")).toContainText("internals not visible");

    // Back to Cascade between turns: applies immediately.
    await page.getByTestId("mode-toggle").getByRole("button", { name: "Cascade" }).click();
    await expect(page.getByTestId("connection-pill")).toHaveText(/WebSocket connected/);
    await waitReady(page);
    await expect(page.getByTestId("turn-card")).toHaveCount(2); // transcripts kept across switches
  });

  test("transcripts show the latest four turns, then scroll for earlier ones", async ({ page }) => {
    await page.goto("/?transport=fake"); // client-only simulator: no backend audio path, no cost
    await waitReady(page);
    const list = page.getByTestId("transcript-list");
    const scrollable = () => list.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    for (const clip of ["en-01", "en-02", "en-03", "en-04"]) await replayTurn(page, clip, "en");
    expect(await scrollable()).toBe(false);
    await replayTurn(page, "en-05", "en");
    await expect(page.getByTestId("turn-card")).toHaveCount(5);
    expect(await scrollable()).toBe(true);
    await expect(page.getByTestId("transcript-count")).toHaveText("latest 4 of 5 · scroll for earlier");
    // The oldest turn is reachable by scrolling the list.
    await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(page.getByTestId("turn-card").last()).toBeInViewport();
  });

  test("phone width: one column, no horizontal scroll, 44px+ targets", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?providers=fake");
    await waitReady(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const id of ["talk-en", "talk-es"]) {
      const box = (await page.getByTestId(id).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
    const modeButton = (await page.getByTestId("mode-toggle").getByRole("button").first().boundingBox())!;
    expect(modeButton.height).toBeGreaterThanOrEqual(44);
  });
});
