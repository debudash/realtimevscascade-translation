import { expect, test } from "@playwright/test";
import { replayTurn, turns, waitReady } from "./helpers";

// M1 acceptance: replaying a WAV through the capture path produces press, access, T0 and
// release marks. Uses the client-only simulated transport: no backend audio path, no keys.
test.describe("audio engine and floor control (simulated transport)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?transport=fake");
    await waitReady(page);
  });

  test("replay produces press, access, T0 and release marks in order", async ({ page }) => {
    const turn = await replayTurn(page, "fixture-en-fever", "en");
    const m = turn.marks;

    expect(turn.status).toBe("completed");
    for (const name of ["press", "access", "speechStart", "t0", "release", "firstAudible"]) {
      expect(m[name], `mark ${name}`).toBeGreaterThan(0);
    }
    expect(m.access).toBeGreaterThanOrEqual(m.press);
    expect(m.speechStart).toBeLessThan(m.t0);
    // T0 is the last voiced frame, not release: the replay adds a silent tail before release.
    expect(m.t0).toBeLessThan(m.release);
    expect(m.release - m.t0).toBeGreaterThan(150);
    expect(m.firstAudible).toBeGreaterThan(m.release);
    expect(turn.conditions).toMatchObject({ mode: "cascade", inputSource: "fixture-en-fever", direction: "en-es" });
  });

  test("a press by the other speaker during a turn is denied, with no first_audible from the tone", async ({ page }) => {
    await page.getByTestId("input-select").selectOption("mic");
    await waitReady(page);
    const en = page.getByTestId("talk-en");
    const es = page.getByTestId("talk-es");

    await en.dispatchEvent("pointerdown", { pointerId: 1, isPrimary: true });
    await expect(en).toHaveAttribute("data-visual", "listening");
    await es.dispatchEvent("pointerdown", { pointerId: 2, isPrimary: true });
    await expect(es).toHaveAttribute("data-visual", "denied");
    await expect(page.getByTestId("status-line")).toHaveText(/Floor busy/);
    await es.dispatchEvent("pointerup", { pointerId: 2, isPrimary: true });

    const [live] = await turns(page);
    expect(live.marks.firstAudible).toBeUndefined();
    await en.dispatchEvent("pointerup", { pointerId: 1, isPrimary: true });
    await waitReady(page);
  });

  test("keyboard hold (Space) runs a turn", async ({ page }) => {
    await page.getByTestId("input-select").selectOption("mic");
    await waitReady(page);
    const es = page.getByTestId("talk-es");
    await es.focus();
    await page.keyboard.down("Space");
    await expect(es).toHaveAttribute("data-visual", "listening");
    await page.waitForTimeout(400);
    await page.keyboard.up("Space");
    await waitReady(page);
    const [turn] = await turns(page);
    expect(turn.conditions).toMatchObject({ direction: "es-en" });
    expect(turn.marks.release).toBeGreaterThan(turn.marks.press);
  });
});
