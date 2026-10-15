import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { replayTurn, waitReady } from "./helpers";

const RUNS_DIR = resolve("harness", "results", "test-runs"); // Playwright runs from the repo root

/** Fills the New test run form and runs it to the end (fake providers: no cost). */
async function runTestRun(page: Page, name: string, setup: string, clips: string[]) {
  await page.getByLabel("Name").fill(name);
  await page.getByRole("radio", { name: setup }).check();
  await page.getByTestId("clinic-terms").getByRole("radio", { name: "Off" }).check();
  await page.getByRole("radio", { name: "Pick clips" }).check();
  for (const c of clips) await page.getByTestId(`clip-${c}`).check();
  await expect(page.getByTestId("estimate")).toContainText(`${clips.length} turns`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "Start run" }).click();
  // The header's setup controls are locked while the run owns the session.
  await expect(page.getByTestId("mode-toggle").getByRole("button").first()).toBeDisabled();
  await expect(page.getByTestId("run-status")).toContainText(`Saved: ${name}`, { timeout: 90_000 });
  await expect(page.getByTestId("mode-toggle").getByRole("button").first()).toBeEnabled();
}

// Test Runs switch the app's setup between turns and play chosen clips through the replay path.
// Everything here uses the server-side fake providers, so it costs nothing.
test.describe("Test Runs", () => {
  test("the controller switches setup between turns and the next turn runs under it", async ({ page }) => {
    await page.goto("/?providers=fake");
    await waitReady(page);
    await page.evaluate(() => window.__workbench!.applySetup({ mode: "cascade", strategy: "clause", controls: false }));
    await waitReady(page);
    const turn = await replayTurn(page, "en-01", "en");
    expect(turn.conditions).toMatchObject({ mode: "cascade", strategy: "clause", controls: false });
    // The header reflects the setup the run chose.
    await expect(page.getByTestId("commit-toggle").getByRole("button", { name: "Clause" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("controls-toggle").getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
  });

  test("a tester runs chosen clips on one setup; runs are saved, listed, opened and compared", async ({ page }) => {
    await page.goto("/?providers=fake");
    await waitReady(page);
    await page.getByRole("tab", { name: "Test Runs" }).click();
    // Only the open tab's panel shows.
    await expect(page.locator("#panel-workbench")).toBeHidden();
    await expect(page.locator("#panel-test-runs")).toBeVisible();

    await runTestRun(page, "e2e clause run", "Cascade · clause", ["en-01", "es-01"]);
    await runTestRun(page, "e2e segment run", "Cascade · segment", ["en-01", "es-01"]);

    // Saved runs are listed newest first with their setup and latency.
    const rows = page.getByTestId("saved-run");
    await expect(rows.first()).toContainText("e2e segment run");
    await expect(rows.first()).toContainText("Cascade · segment");
    await expect(rows.nth(1)).toContainText("e2e clause run");

    // Detail: every turn of the run with its clip and mouth-to-ear.
    await rows.nth(1).getByRole("button", { name: "e2e clause run" }).click();
    const detail = page.getByTestId("run-detail");
    await expect(detail).toContainText("Cascade · clause");
    await expect(detail.getByTestId("run-turn")).toHaveCount(2);
    await expect(detail.getByTestId("run-turn").first()).toContainText(/\d\.\d\d s/);

    // Compare: two runs side by side with the per-clip difference.
    await rows.nth(0).getByRole("checkbox").check();
    await rows.nth(1).getByRole("checkbox").check();
    await page.getByRole("button", { name: "Compare selected" }).click();
    const compare = page.getByTestId("run-compare");
    await expect(compare).toContainText("e2e segment run");
    await expect(compare).toContainText("e2e clause run");
    await expect(compare.getByTestId("clip-delta")).toHaveCount(2);
  });

  test.afterAll(() => {
    // Keep e2e runs out of the measured data.
    if (!existsSync(RUNS_DIR)) return;
    for (const f of readdirSync(RUNS_DIR, { withFileTypes: true }).filter((e) => e.isFile() && e.name.includes("-e2e-"))) rmSync(join(RUNS_DIR, f.name));
  });
});
