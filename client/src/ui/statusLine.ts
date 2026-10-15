import type { ChipId, Snapshot } from "../session/controller";

export const CHIP_LABEL: Record<ChipId, string> = {
  capture: "Capture",
  stt: "STT",
  commit: "Commit",
  translate: "Translate",
  tts: "TTS",
  model: "gpt-realtime",
  playing: "Playing",
};

/** The aria-live status line under the talk buttons (docs/ui-spec.md, speaker stage). */
export function statusLine(s: Snapshot, now: number): string {
  if (s.denied) return "Floor busy · wait for the interpretation to finish";
  switch (s.turn.phase) {
    case "Warming":
      return "Connecting. Talk buttons are not ready yet.";
    case "Error":
      return "Not ready. See the message above.";
    case "Ready":
      return "Ready. Each speaker holds their own button.";
    case "Capturing": {
      const secs = s.listeningSince === null ? 0 : (now - s.listeningSince) / 1000;
      return `Listening · ${secs.toFixed(1)} s`;
    }
    case "Finalizing":
      if (s.turn.mode === "realtime") return "Waiting for gpt-realtime response";
      return `Interpreting · ${CHIP_LABEL[s.activeChip && s.activeChip !== "capture" ? s.activeChip : "stt"]}`;
    case "Playing":
      return "Playing interpretation · capture muted";
  }
}
