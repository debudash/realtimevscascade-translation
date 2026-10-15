import { describe, expect, it } from "vitest";
import { initialTurnState, turnReducer, type Phase, type TurnAction, type TurnEffect, type TurnState } from "./turnMachine";

function at(phase: Phase, extra: Partial<TurnState> = {}): TurnState {
  const busy = phase === "Capturing" || phase === "Finalizing" || phase === "Playing";
  return {
    ...initialTurnState("cascade"),
    phase,
    speaker: busy ? "en" : null,
    turnId: busy ? "t1" : null,
    ...extra,
  };
}

const pressEs: TurnAction = { type: "PRESS", speaker: "es", turnId: "t2" };

interface Row {
  name: string;
  from: TurnState;
  action: TurnAction;
  phase: Phase;
  effects: TurnEffect["type"][];
  check?: (s: TurnState) => void;
}

const rows: Row[] = [
  // Warm-up
  { name: "Warming + WARM_DONE -> Ready", from: at("Warming"), action: { type: "WARM_DONE" }, phase: "Ready", effects: [] },
  { name: "press while Warming is 'Not ready'", from: at("Warming"), action: pressEs, phase: "Warming", effects: ["notReady"] },

  // Normal turn
  { name: "Ready + press -> Capturing, starts the turn", from: at("Ready"), action: pressEs, phase: "Capturing", effects: ["startTurn"],
    check: (s) => expect([s.speaker, s.turnId]).toEqual(["es", "t2"]) },
  { name: "owner release -> Finalizing", from: at("Capturing"), action: { type: "RELEASE", speaker: "en" }, phase: "Finalizing", effects: ["releaseTurn"] },
  { name: "other speaker's release is ignored", from: at("Capturing"), action: { type: "RELEASE", speaker: "es" }, phase: "Capturing", effects: [] },
  { name: "playback start -> Playing", from: at("Finalizing"), action: { type: "PLAYBACK_START" }, phase: "Playing", effects: [] },
  { name: "Playing + TURN_DONE -> Ready", from: at("Playing"), action: { type: "TURN_DONE" }, phase: "Ready", effects: [],
    check: (s) => expect(s.speaker).toBeNull() },
  { name: "empty turn: Finalizing + TURN_DONE -> Ready", from: at("Finalizing"), action: { type: "TURN_DONE" }, phase: "Ready", effects: [] },

  // Floor deny: state does not change
  { name: "deny in Capturing", from: at("Capturing"), action: pressEs, phase: "Capturing", effects: ["floorDenied"],
    check: (s) => expect(s.speaker).toBe("en") },
  { name: "deny in Finalizing", from: at("Finalizing"), action: pressEs, phase: "Finalizing", effects: ["floorDenied"] },
  { name: "deny in Playing", from: at("Playing"), action: pressEs, phase: "Playing", effects: ["floorDenied"] },
  { name: "owner key-repeat while Capturing is not a deny", from: at("Capturing"), action: { type: "PRESS", speaker: "en", turnId: "x" }, phase: "Capturing", effects: [] },

  // Mode switch
  { name: "switch in Ready applies now", from: at("Ready"), action: { type: "SWITCH_MODE", mode: "realtime" }, phase: "Warming", effects: ["applyMode"],
    check: (s) => expect(s.mode).toBe("realtime") },
  { name: "switch mid-turn is queued", from: at("Capturing"), action: { type: "SWITCH_MODE", mode: "realtime" }, phase: "Capturing", effects: ["switchQueued"],
    check: (s) => expect([s.mode, s.pendingMode]).toEqual(["cascade", "realtime"]) },
  { name: "switch queued in Playing", from: at("Playing"), action: { type: "SWITCH_MODE", mode: "realtime" }, phase: "Playing", effects: ["switchQueued"] },
  { name: "queued switch applies when the turn ends", from: at("Playing", { pendingMode: "realtime" }), action: { type: "TURN_DONE" }, phase: "Warming", effects: ["applyMode"],
    check: (s) => expect([s.mode, s.pendingMode]).toEqual(["realtime", null]) },
  { name: "'Stay on current' cancels the queued switch", from: at("Playing", { pendingMode: "realtime" }), action: { type: "CANCEL_SWITCH" }, phase: "Playing", effects: [],
    check: (s) => expect(s.pendingMode).toBeNull() },
  { name: "switching back to the current mode clears the queue", from: at("Capturing", { pendingMode: "realtime" }), action: { type: "SWITCH_MODE", mode: "cascade" }, phase: "Capturing", effects: [],
    check: (s) => expect(s.pendingMode).toBeNull() },

  // Errors
  { name: "error mid-turn cancels the turn", from: at("Capturing"), action: { type: "ERROR", code: "socket_drop" }, phase: "Error", effects: ["cancelTurn"],
    check: (s) => expect(s.errorCode).toBe("socket_drop") },
  { name: "error in Ready", from: at("Ready"), action: { type: "ERROR", code: "mic_denied" }, phase: "Error", effects: [] },
  { name: "press while Error is 'Not ready'", from: at("Error"), action: pressEs, phase: "Error", effects: ["notReady"] },
  { name: "Error -> Ready on recovery", from: at("Error", { errorCode: "socket_drop" }), action: { type: "RECOVER" }, phase: "Ready", effects: [],
    check: (s) => expect(s.errorCode).toBeNull() },
  { name: "recovery applies a queued switch", from: at("Error", { pendingMode: "realtime" }), action: { type: "RECOVER" }, phase: "Warming", effects: ["applyMode"] },
  { name: "TURN_DONE in Error is ignored", from: at("Error"), action: { type: "TURN_DONE" }, phase: "Error", effects: [] },
];

describe("turn / floor state machine", () => {
  it.each(rows)("$name", ({ from, action, phase, effects, check }) => {
    const { state, effects: out } = turnReducer(from, action);
    expect(state.phase).toBe(phase);
    expect(out.map((e) => e.type)).toEqual(effects);
    check?.(state);
  });

  it("never mutates the input state", () => {
    const s = at("Ready");
    const copy = structuredClone(s);
    turnReducer(s, pressEs);
    expect(s).toEqual(copy);
  });
});
