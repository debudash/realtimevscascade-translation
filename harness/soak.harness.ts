// Soak test: 5 minutes of back-and-forth per mode (clips alternate EN/ES speakers). Records
// disconnects, playback buffer depth over time, browser heap at start vs. end, and recovery time
// after one forced transport drop at the midpoint (drop -> Ready, transcripts intact).
//   npx playwright test -c harness/playwright.harness.config.ts soak.harness.ts
//   SOAK_MODES=cascade  limits the modes; SOAK_MINUTES overrides the length (default 5).
// Guardrail: at most one soak run per mode (CLAUDE.md); a second run is skipped.
import { expect, test, type Page } from "@playwright/test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hasKey } from "../scripts/env.mjs";
import { turns, waitReady } from "../e2e/helpers";
import { ensureDir, loadScripts, resultsDir } from "./lib";

const MODES = (process.env.SOAK_MODES ?? "realtime,cascade").split(",");
const MINUTES = Number(process.env.SOAK_MINUTES ?? 5);

interface Sample {
  t: number;
  heapBytes?: number;
  bufferedSamples?: number;
  underruns?: number;
  rtJitterBufferMs?: number;
  rtConcealedSamples?: number;
  rtTotalSamples?: number;
  connection: string;
}

async function snapshot(page: Page): Promise<{ phase: string; connection: string; diag: Record<string, number> }> {
  return page.evaluate(() => {
    const w = window.__workbench!;
    const s = w.getSnapshot();
    return { phase: s.turn.phase, connection: s.connection.state, diag: w.diagnostics() };
  });
}

for (const mode of MODES) {
  test(`soak: ${mode}`, async ({ page }) => {
    const keys = mode === "realtime" ? ["OpenAI__ApiKey"] : ["Deepgram__ApiKey", "OpenAI__ApiKey", "ElevenLabs__ApiKey"];
    test.skip(keys.some((k) => !hasKey(k)), "Skipped: provider keys missing from .env");
    const out = join(resultsDir, `soak-${mode}.json`);
    test.skip(existsSync(out) && !process.env.SOAK_FORCE, `Cost guardrail: ${out} exists (one soak run per mode).`);

    const clips = loadScripts().clips.filter((c) => !c.pair);
    const en = clips.filter((c) => c.lang === "en");
    const es = clips.filter((c) => c.lang === "es");
    await page.goto(mode === "realtime" ? "/?mode=realtime" : "/");
    await waitReady(page);

    const durationMs = MINUTES * 60_000;
    const start = Date.now();
    const samples: Sample[] = [];
    const connectionChanges: { t: number; state: string }[] = [];
    let lastConnection = "Connected";
    let drop: { at: number; recoveredAt?: number; recoveryMs?: number; turnsBefore: number; turnsAfter?: number } | null = null;
    let turnErrors = 0;
    let n = 0;

    const sample = async () => {
      const s = await snapshot(page);
      if (s.connection !== lastConnection) {
        connectionChanges.push({ t: Date.now() - start, state: s.connection });
        lastConnection = s.connection;
      }
      samples.push({ t: Date.now() - start, connection: s.connection, ...s.diag });
      return s;
    };
    await sample();

    while (Date.now() - start < durationMs) {
      // Midpoint: force one transport drop and time the recovery.
      if (!drop && Date.now() - start > durationMs / 2) {
        const before = (await turns(page)).length;
        drop = { at: Date.now() - start, turnsBefore: before };
        const t0 = Date.now();
        await page.evaluate(() => window.__workbench!.forceDrop());
        // Wait for the drop to register (Error / Reconnecting), then for recovery to Ready.
        await expect.poll(async () => (await snapshot(page)).phase, { timeout: 10_000, intervals: [20] }).toBe("Error");
        await sample();
        await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000, intervals: [50] }).toBe("Ready");
        drop.recoveryMs = Date.now() - t0;
        drop.recoveredAt = Date.now() - start;
        drop.turnsAfter = (await turns(page)).length;
      }

      const clip = n % 2 === 0 ? en[(n / 2) % en.length] : es[((n - 1) / 2) % es.length];
      await page.getByTestId("input-select").selectOption(clip.id);
      await waitReady(page);
      const before = (await turns(page)).length;
      await page.getByTestId(`talk-${clip.lang}`).click();
      await expect.poll(async () => {
        const all = await turns(page);
        return all.length > before && all[0].status !== "live";
      }, { timeout: 60_000, intervals: [200] }).toBe(true);
      const [last] = await turns(page);
      if (last.status !== "completed") turnErrors++;
      n++;
      await sample();
    }
    await sample();

    const heap = samples.map((s) => s.heapBytes).filter((h): h is number => typeof h === "number");
    const result = {
      mode,
      minutes: MINUTES,
      turns: n,
      turnErrors,
      disconnects: connectionChanges.filter((c) => c.state === "Reconnecting" || c.state === "Failed").length,
      forcedDrop: drop,
      heapStartBytes: heap[0] ?? null,
      heapEndBytes: heap[heap.length - 1] ?? null,
      maxBufferedSamples: Math.max(0, ...samples.map((s) => s.bufferedSamples ?? 0)),
      underrunsAtEnd: samples[samples.length - 1].underruns ?? null,
      // Realtime: WebRTC getStats() cumulative jitter-buffer delay and concealment at the end of the soak.
      rtJitterBufferMsAtEnd: samples[samples.length - 1].rtJitterBufferMs ?? null,
      rtConcealedPctAtEnd: (() => {
        const last = samples[samples.length - 1];
        return last.rtTotalSamples ? (100 * (last.rtConcealedSamples ?? 0)) / last.rtTotalSamples : null;
      })(),
      connectionChanges,
      samples,
      finishedAt: new Date().toISOString(),
    };
    ensureDir(resultsDir);
    writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(`soak ${mode}: ${n} turns, ${turnErrors} failed, drop recovery ${drop?.recoveryMs} ms, heap ${result.heapStartBytes} -> ${result.heapEndBytes}`);
    expect(n).toBeGreaterThan(5);
  });
}
