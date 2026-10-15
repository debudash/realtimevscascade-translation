import { expect, test } from "@playwright/test";
import { replayTurn, waitReady } from "./helpers";

// M3 acceptance: a cascade turn works end to end over /ws/cascade with server-side fake providers
// (no keys, no cost). The fixture clip goes through the real capture path and WebSocket.
test.describe("Cascade over WebSocket with fake providers", () => {
  test("a replayed EN clip produces source, target, audio and stage timings", async ({ page }) => {
    await page.goto("/?providers=fake");
    await waitReady(page);
    await expect(page.getByTestId("connection-pill")).toHaveText(/WebSocket connected/);

    const turn = await replayTurn(page, "fixture-en-fever", "en");

    expect(turn.status).toBe("completed");
    expect(turn.sourceText).toContain("My son");
    expect(turn.targetText).toMatch(/^\[es\]/);
    for (const name of ["press", "access", "t0", "release", "sttFinal", "translateFirstToken", "ttsFirstByte", "firstAudible"]) {
      expect(turn.marks[name], `mark ${name}`).toBeGreaterThan(0);
    }
    expect(turn.marks.firstAudible).toBeGreaterThan(turn.marks.release);
    expect(turn.conditions).toMatchObject({ mode: "cascade", strategy: "segment", providers: ["fake", "fake", "fake"] });
  });

  test("injected 429s fail over and the failover is recorded on the turn", async ({ page }) => {
    await page.goto("/?providers=fake&faults=translation:429");
    await waitReady(page);
    const turn = await replayTurn(page, "fixture-en-fever", "en");
    expect(turn.status).toBe("completed");
    expect(JSON.stringify(turn)).toContain("fake-deepl");
  });

  test("an injected translation timeout fails the turn with provider_timeout and frees the floor", async ({ page }) => {
    await page.goto("/?providers=fake&faults=translation:timeout");
    await waitReady(page);
    const turn = await replayTurn(page, "fixture-en-fever", "en");
    expect(turn.status).toBe("failed");
    expect(turn.error).toMatchObject({ code: "provider_timeout", stage: "translation" });
    await expect(page.getByTestId("turn-error")).toContainText("Timed out at translation");
  });
});
