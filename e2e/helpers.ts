import { expect, type Page } from "@playwright/test";

export interface TurnLike {
  turnId: string;
  status: string;
  marks: Record<string, number>;
  sourceText: string;
  targetText: string;
  conditions: Record<string, unknown>;
  error?: { code: string; message: string };
  playback?: { jitterBufferMs: number; concealedPct: number; packetsLost: number };
}

/** Reads all turns (newest first) from the app's test hook. */
export async function turns(page: Page): Promise<TurnLike[]> {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__workbench!.metrics.all())));
}

export async function waitReady(page: Page): Promise<void> {
  await expect(page.getByTestId("status-line")).toHaveText(/^Ready/, { timeout: 30_000 });
}

/** Selects a replay clip, clicks the speaker's button, and waits for the turn to finish. */
export async function replayTurn(page: Page, clipId: string, speaker: string, timeoutMs = 45_000): Promise<TurnLike> {
  await page.getByTestId("input-select").selectOption(clipId);
  await waitReady(page);
  const before = (await turns(page)).length;
  await page.getByTestId(`talk-${speaker}`).click();
  await expect
    .poll(async () => {
      const all = await turns(page);
      return all.length > before && all[0].status !== "live" ? all[0].status : "live";
    }, { timeout: timeoutMs })
    .not.toBe("live");
  await waitReady(page);
  return (await turns(page))[0];
}
