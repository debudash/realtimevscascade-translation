import { expect, test } from "@playwright/test";
import { replayTurn, waitReady } from "./helpers";

test("mic_denied: blocking panel; 'Use replay clips' recovers", async ({ page }) => {
  // Headless Chromium grants the fake device regardless of prompt flags, so simulate the browser's
  // answer for a blocked site at the API boundary: getUserMedia rejects with NotAllowedError.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  });
  await page.goto("/?providers=fake");
  const panel = page.getByTestId("mic-denied");
  await expect(panel).toContainText("Microphone access is blocked");
  await expect(page.getByTestId("talk-en")).toHaveAttribute("data-visual", "notready");
  await panel.getByRole("button", { name: "Use replay clips" }).click();
  await expect(panel).toBeHidden();
  await waitReady(page);
  expect((await replayTurn(page, "en-01", "en")).status).toBe("completed");
});
