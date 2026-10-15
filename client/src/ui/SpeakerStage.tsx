import { useEffect, useState } from "react";
import type { ChipId } from "../session/controller";
import { CHIP_LABEL, statusLine } from "./statusLine";
import { TalkButton, buttonVisual } from "./TalkButton";
import { useController, useSnapshot } from "./useController";

const CASCADE_CHIPS: ChipId[] = ["capture", "stt", "commit", "translate", "tts", "playing"];
const REALTIME_CHIPS: ChipId[] = ["capture", "model", "playing"];

export function SpeakerStage() {
  const c = useController();
  const s = useSnapshot();
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (s.turn.phase !== "Capturing") return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [s.turn.phase]);

  const pair = s.config?.pairs.find((p) => p.id === s.pairId);
  const lang = (code: string) => s.config?.languages.find((l) => l.code === code);
  const speakers = pair ? [pair.a, pair.b] : [];
  const title = pair ? speakers.map((code) => (lang(code)?.nativeName ?? code).toUpperCase()).join(" ↔ ") : "";
  const chips = s.turn.mode === "realtime" ? REALTIME_CHIPS : CASCADE_CHIPS;
  const replay = s.input !== "mic";

  return (
    <section className="stage" aria-label="Speaker stage">
      <div className="stage__title">{title}</div>
      <div className="stage__buttons">
        {speakers.map((code) => {
          const other = speakers.find((x) => x !== code)!;
          return (
            <TalkButton
              key={code}
              speaker={code}
              label={lang(code)?.speakerLabel ?? code}
              direction={`${code.toUpperCase()} → ${other.toUpperCase()}`}
              visual={buttonVisual(s, code)}
              listeningSince={s.listeningSince}
              replay={replay}
              onPress={() => void c.press(code)}
              onRelease={() => c.release(code)}
            />
          );
        })}
      </div>
      <div className="stage__level" aria-hidden>
        <div className="stage__level-fill" style={{ width: `${Math.round(s.level * 100)}%` }} />
      </div>
      <p className="stage__status" aria-live="polite" data-testid="status-line">
        {statusLine(s, now)}
      </p>
      <ol className="chips" aria-label="Pipeline">
        {chips.map((chip) => (
          <li
            key={chip}
            className={`chip ${chip === "model" ? "chip--hidden" : ""} ${s.activeChip === chip ? "chip--active" : ""}`}
            aria-current={s.activeChip === chip ? "step" : undefined}
          >
            {chip === "model" ? "gpt-realtime · internals not visible" : CHIP_LABEL[chip]}
          </li>
        ))}
      </ol>
      <p className="stage__help">
        {replay
          ? "Replay input: click a speaker's button to play the selected clip through the same capture path."
          : "Each speaker holds their own button, or focuses it and holds Space. Capture is muted while the interpretation plays."}
      </p>
    </section>
  );
}
