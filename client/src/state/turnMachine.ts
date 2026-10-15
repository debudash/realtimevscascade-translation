// Turn / floor state machine (docs/architecture.md §4). Browser-side and authoritative.
// Pure reducer: (state, action) -> { state, effects }. The controller performs the effects.

export type Mode = "realtime" | "cascade";

export type Phase = "Warming" | "Ready" | "Capturing" | "Finalizing" | "Playing" | "Error";

export interface TurnState {
  phase: Phase;
  mode: Mode;
  /** Speaker (source language code) holding the floor, if any. */
  speaker: string | null;
  turnId: string | null;
  /** A mode switch requested mid-turn, applied when the turn returns to Ready. */
  pendingMode: Mode | null;
  errorCode: string | null;
}

export type TurnAction =
  | { type: "WARM_DONE" }
  | { type: "PRESS"; speaker: string; turnId: string }
  | { type: "RELEASE"; speaker: string }
  | { type: "PLAYBACK_START" }
  /** The turn is over: playback drained (or nothing to play) and the transport reported turn end. */
  | { type: "TURN_DONE" }
  | { type: "SWITCH_MODE"; mode: Mode }
  | { type: "CANCEL_SWITCH" }
  /** A session-level failure (socket drop, mic denied, config). Turn-level failures end the turn instead. */
  | { type: "ERROR"; code: string }
  | { type: "RECOVER" };

export type TurnEffect =
  | { type: "startTurn"; speaker: string; turnId: string }
  | { type: "releaseTurn"; turnId: string }
  | { type: "cancelTurn"; turnId: string }
  | { type: "floorDenied"; speaker: string }
  | { type: "notReady"; speaker: string }
  /** Tear down the current transport and warm the new mode. */
  | { type: "applyMode"; mode: Mode }
  | { type: "switchQueued"; mode: Mode };

export interface Transition {
  state: TurnState;
  effects: TurnEffect[];
}

export function initialTurnState(mode: Mode): TurnState {
  return { phase: "Warming", mode, speaker: null, turnId: null, pendingMode: null, errorCode: null };
}

const BUSY: Phase[] = ["Capturing", "Finalizing", "Playing"];

export function isBusy(phase: Phase): boolean {
  return BUSY.includes(phase);
}

function applyMode(s: TurnState, mode: Mode): Transition {
  return {
    state: { ...s, phase: "Warming", mode, pendingMode: null, speaker: null, turnId: null, errorCode: null },
    effects: [{ type: "applyMode", mode }],
  };
}

function backToReady(s: TurnState): Transition {
  const ready: TurnState = { ...s, phase: "Ready", speaker: null, turnId: null, errorCode: null };
  return ready.pendingMode ? applyMode(ready, ready.pendingMode) : { state: ready, effects: [] };
}

export function turnReducer(s: TurnState, a: TurnAction): Transition {
  const same = (state: TurnState = s, effects: TurnEffect[] = []): Transition => ({ state, effects });

  switch (a.type) {
    case "WARM_DONE":
      return s.phase === "Warming" ? same({ ...s, phase: "Ready" }) : same();

    case "PRESS":
      if (s.phase === "Ready") {
        return same({ ...s, phase: "Capturing", speaker: a.speaker, turnId: a.turnId }, [
          { type: "startTurn", speaker: a.speaker, turnId: a.turnId },
        ]);
      }
      if (s.phase === "Capturing" && s.speaker === a.speaker) return same(); // key repeat by the owner
      if (isBusy(s.phase)) return same(s, [{ type: "floorDenied", speaker: a.speaker }]);
      return same(s, [{ type: "notReady", speaker: a.speaker }]); // Warming or Error

    case "RELEASE":
      if (s.phase === "Capturing" && s.speaker === a.speaker && s.turnId) {
        return same({ ...s, phase: "Finalizing" }, [{ type: "releaseTurn", turnId: s.turnId }]);
      }
      return same();

    case "PLAYBACK_START":
      return s.phase === "Finalizing" ? same({ ...s, phase: "Playing" }) : same();

    case "TURN_DONE":
      return s.phase === "Finalizing" || s.phase === "Playing" ? backToReady(s) : same();

    case "SWITCH_MODE":
      if (a.mode === s.mode) return same({ ...s, pendingMode: null });
      if (s.phase === "Ready" || s.phase === "Warming") return applyMode(s, a.mode);
      // A failed warm-up ("internal") is escaped by switching modes; other session errors
      // (socket drop, mic denied, config) must recover first, so the switch waits.
      if (s.phase === "Error" && s.errorCode === "internal") return applyMode(s, a.mode);
      return same({ ...s, pendingMode: a.mode }, [{ type: "switchQueued", mode: a.mode }]);

    case "CANCEL_SWITCH":
      return same({ ...s, pendingMode: null });

    case "ERROR": {
      const effects: TurnEffect[] = s.turnId && isBusy(s.phase) ? [{ type: "cancelTurn", turnId: s.turnId }] : [];
      return same({ ...s, phase: "Error", speaker: null, turnId: null, errorCode: a.code }, effects);
    }

    case "RECOVER":
      return s.phase === "Error" ? backToReady(s) : same();
  }
}
