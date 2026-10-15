import { expect, test } from "@playwright/test";
import { hasKey, missingKeyMessage } from "../scripts/env.mjs";
import { replayTurn, waitReady, type TurnLike } from "./helpers";

// M4 acceptance: an EN clip and an ES clip each work end to end on real providers in
// cascade-segment mode (Deepgram -> OpenAI streamed translation -> ElevenLabs). Costs ~1 cent.
const KEYS = ["Deepgram__ApiKey", "OpenAI__ApiKey", "ElevenLabs__ApiKey"];

function logTurn(label: string, t: TurnLike) {
  const m = t.marks;
  const d = (a: string, b: string) => (m[a] !== undefined && m[b] !== undefined ? `${(m[a] - m[b]).toFixed(0)}` : "-");
  console.log(
    `${label}: mouth-to-ear ${d("firstAudible", "t0")} ms | release->sttFinal ${d("sttFinal", "release")} ` +
      `| ->1st tok ${d("translateFirstToken", "release")} | ->tts byte ${d("ttsFirstByte", "release")} | access ${d("access", "press")} ` +
      `| "${t.sourceText}" -> "${t.targetText}"`,
  );
}

test.describe("Cascade on real providers (segment)", () => {
  for (const k of KEYS) test.skip(!hasKey(k), missingKeyMessage(k));

  test("EN clip -> Spanish, ES clip -> English, with every stage timed", async ({ page }) => {
    await page.goto("/");
    await waitReady(page);
    await expect(page.getByTestId("connection-pill")).toHaveText(/WebSocket connected/);

    const en = await replayTurn(page, "en-01", "en", 60_000);
    logTurn("en-01", en);
    expect(en.status).toBe("completed");
    expect(en.sourceText.toLowerCase()).toContain("fever");
    expect(en.targetText.toLowerCase()).toMatch(/fiebre/);
    expect(en.conditions).toMatchObject({ mode: "cascade", strategy: "segment", direction: "en-es" });

    const es = await replayTurn(page, "es-01", "es", 60_000);
    logTurn("es-01", es);
    expect(es.status).toBe("completed");
    expect(es.sourceText.toLowerCase()).toMatch(/cita/);
    expect(es.targetText.toLowerCase()).toMatch(/appointment/);
    expect(es.conditions).toMatchObject({ direction: "es-en" });

    for (const t of [en, es]) {
      for (const name of ["press", "access", "t0", "release", "sttFinal", "translateFirstToken", "ttsFirstByte", "firstAudible"]) {
        expect(t.marks[name], `${t.turnId} mark ${name}`).toBeGreaterThan(0);
      }
    }
  });
});
