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
    await expect(page.getByTestId("headline-latency")).toHaveText(/\d\.\d\d s/);
    await expect(page.getByTestId("waterfall")).toContainText("TTS first byte");
    await expect(page.locator('[data-key="cascade-segment"] td').nth(1)).toHaveText("1");

    // Commit policy switch between turns.
    await page.getByTestId("commit-toggle").getByRole("button", { name: "Clause" }).click();
    await waitReady(page);
    const clause = await replayTurn(page, "es-01", "es");
    expect(clause.conditions).toMatchObject({ strategy: "clause", direction: "es-en" });
    await expect(page.getByTestId("turn-card").first()).toContainText("CASCADE · CLAUSE");
    await expect(page.locator('[data-key="cascade-clause"] td').nth(1)).toHaveText("1");

    // Export downloads JSON of all turns with marks and run conditions.
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-metrics").click()]);
    const body = JSON.parse(await (await download.createReadStream())!.toArray().then((c) => Buffer.concat(c).toString()));
    expect(body.turns).toHaveLength(2);
    expect(body.turns[0].marks.press).toBeGreaterThan(0);
    expect(body.turns[1].conditions.strategy).toBe("clause");
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
    await expect(page.getByTestId("waterfall")).toContainText("hidden");
    await expect(page.locator(".chip--hidden")).toContainText("internals not visible");

    // Back to Cascade between turns: applies immediately.
    await page.getByTestId("mode-toggle").getByRole("button", { name: "Cascade" }).click();
    await expect(page.getByTestId("connection-pill")).toHaveText(/WebSocket connected/);
    await waitReady(page);
    await expect(page.getByTestId("turn-card")).toHaveCount(2); // transcripts kept across switches
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
