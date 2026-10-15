import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Snapshot } from "../session/controller";

export type ButtonVisual = "idle" | "listening" | "interpreting" | "playing" | "wait" | "denied" | "notready";

export function buttonVisual(s: Snapshot, speaker: string): ButtonVisual {
  if (s.denied === speaker) return "denied";
  const { phase } = s.turn;
  if (phase === "Warming" || phase === "Error" || s.notReadyFlash === speaker) return "notready";
  if (phase === "Ready") return "idle";
  if (s.turn.speaker !== speaker) return "wait";
  if (phase === "Capturing") return "listening";
  if (phase === "Finalizing") return "interpreting";
  return "playing";
}

const CAPTION: Record<ButtonVisual, string> = {
  idle: "Hold to talk",
  listening: "Listening",
  interpreting: "Interpreting",
  playing: "Playing",
  wait: "Wait",
  denied: "Floor busy",
  notready: "Not ready",
};

interface Props {
  speaker: string;
  label: string;
  direction: string;
  visual: ButtonVisual;
  listeningSince: number | null;
  /** Replay input: a click runs an automated turn instead of press-and-hold. */
  replay: boolean;
  onPress: () => void;
  onRelease: () => void;
}

/** Round push-to-talk button: pointer hold, or Space / Enter hold. */
export function TalkButton({ speaker, label, direction, visual, listeningSince, replay, onPress, onRelease }: Props) {
  const held = useRef(false);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (visual !== "listening") return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [visual]);

  const down = () => {
    if (held.current) return;
    held.current = true;
    onPress();
  };
  const up = () => {
    if (!held.current) return;
    held.current = false;
    onRelease();
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // release fires even if the finger slides off
    } catch {
      /* pointer no longer active */
    }
    down();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (!e.repeat) down();
  };
  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    up();
  };

  const timer = visual === "listening" && listeningSince !== null ? `${((now - listeningSince) / 1000).toFixed(1)} s` : null;

  return (
    <div className={`talk talk--${visual}`} data-speaker={speaker}>
      <button
        type="button"
        className="talk__button"
        data-testid={`talk-${speaker}`}
        data-visual={visual}
        aria-label={`${label}, ${direction}. ${replay ? "Click to play the replay clip." : "Hold to talk."}`}
        aria-disabled={visual === "notready"}
        onPointerDown={onPointerDown}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        {visual === "listening" && <span className="talk__rings" aria-hidden />}
        {visual === "interpreting" && <span className="talk__spinner" aria-hidden />}
        <span className="talk__caption">{replay && visual === "idle" ? "Play clip" : CAPTION[visual]}</span>
        {timer && <span className="talk__timer">{timer}</span>}
      </button>
      <div className="talk__label">{label}</div>
      <div className="talk__dir">{direction}</div>
    </div>
  );
}
