import { expect, test } from "@playwright/test";
import { replayTurn, waitReady } from "./helpers";

// M5 acceptance: every error state in docs/ui-spec.md is reachable, by injecting fake failures
// (server-side fakes via ?faults=), stubbing an endpoint, forcing a transport drop, or denying the mic.
test.describe("error and transition states", () => {
  test("provider_timeout: inline on the turn card with Retry turn", async ({ page }) => {
    await page.goto("/?providers=fake&faults=translation:timeout");
    await waitReady(page);
    await replayTurn(page, "en-01", "en");
    const err = page.getByTestId("turn-error").first();
    await expect(err).toContainText("Timed out at translation");
    await expect(err).toContainText("No first token within 2.0 s");
    await expect(err.getByRole("button", { name: "Retry turn" })).toBeVisible();
  });

  test("provider_error: inline with the HTTP status", async ({ page }) => {
    await page.goto("/?providers=fake&faults=tts:400");
    await waitReady(page);
    await replayTurn(page, "en-01", "en");
    await expect(page.getByTestId("turn-error").first()).toContainText("Provider error at speech synthesis (HTTP 400)");
  });

  test("rate_limited: toast, DeepL failover recorded on the turn", async ({ page }) => {
    await page.goto("/?providers=fake&faults=translation:429");
    await waitReady(page);
    await replayTurn(page, "en-01", "en");
    await expect(page.getByTestId("toast")).toContainText("Translation provider busy");
    await expect(page.getByTestId("toast")).toContainText("This is recorded on the turn.");
    await expect(page.getByTestId("turn-card").first()).toContainText("Failover: translation: fake → fake-deepl");
  });

  test("empty_result: neutral note, not an error", async ({ page }) => {
    await page.goto("/?providers=fake&faults=stt:empty");
    await waitReady(page);
    const turn = await replayTurn(page, "en-01", "en");
    expect(turn.status).toBe("empty");
    const card = page.getByTestId("turn-card").first();
    await expect(card).toContainText("No speech detected. Hold the button while you talk.");
    await expect(card.getByTestId("turn-error")).toHaveCount(0);
  });

  test("socket_drop: banner with attempt n of 5, buttons disabled, then recovery", async ({ page }) => {
    await page.goto("/?providers=fake");
    await waitReady(page);
    await page.evaluate(() => window.__workbench!.forceDrop());
    await expect(page.getByTestId("socket-drop")).toContainText(/Connection lost\. Reconnecting, attempt 1 of 5/);
    await expect(page.getByTestId("talk-en")).toHaveAttribute("data-visual", "notready");
    await expect(page.getByTestId("connection-pill")).toHaveText(/WebSocket connected/, { timeout: 15_000 });
    await expect(page.getByTestId("socket-drop")).toBeHidden();
    await waitReady(page);
    const turn = await replayTurn(page, "en-01", "en");
    expect(turn.status).toBe("completed");
  });

  test("config_error: startup panel naming the missing variables", async ({ page }) => {
    await page.route("**/api/health", (route) =>
      route.fulfill({
        json: { status: "ok", configOk: false, missing: ["Deepgram__ApiKey", "DeepL__ApiKey"], providers: {} },
      }),
    );
    await page.goto("/");
    const panel = page.getByRole("alert").filter({ hasText: "Configuration missing" });
    await expect(panel).toContainText("Add these to .env in the project folder, then restart the app.");
    await expect(page.getByTestId("missing-vars")).toHaveText("Deepgram__ApiKeyDeepL__ApiKey");
    await expect(page.getByTestId("talk-en")).toHaveAttribute("data-visual", "notready");
  });

  test("internal: a session that cannot start says so", async ({ page }) => {
    await page.route("**/api/realtime/session", (route) =>
      route.fulfill({ status: 502, json: { code: "internal", message: "Simulated failure" } }),
    );
    await page.goto("/?mode=realtime");
    await expect(page.getByTestId("session-error")).toContainText("Could not start the session");
    await expect(page.getByTestId("session-error")).toContainText("Simulated failure (internal)");
  });
});
