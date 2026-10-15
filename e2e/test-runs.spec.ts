import { expect, test } from "@playwright/test";
import { replayTurn, waitReady } from "./helpers";

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
});
