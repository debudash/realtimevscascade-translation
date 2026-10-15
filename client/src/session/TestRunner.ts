// Runs one Test Run: puts the session on the chosen setup, plays each chosen clip through the
// replay path (the same path as the harness), collects the turns and saves the run. Lives outside
// React so a run keeps going when the tester switches tabs.

import { api } from "../api";
import pricingTable from "../../../harness/pricing.json";
import { turnCost, type Pricing } from "../state/cost";
import type { TurnRecord } from "../state/metrics";
import type { WorkbenchController } from "./controller";
import { SETUPS, summarizeRun, type PlannedClip, type SetupKey } from "./testRun";

const pricing = pricingTable as unknown as Pricing;
/** A turn that has not finished this long after release is abandoned (the controller's safety net is 30 s). */
const TURN_DONE_TIMEOUT_MS = 45000;

export interface TestRunPlan {
  name: string;
  setupKey: SetupKey;
  controls: boolean;
  clips: PlannedClip[];
  passes: number;
}

export interface RunnerState {
  status: "idle" | "running" | "saving" | "saved" | "failed";
  plan: TestRunPlan | null;
  done: number;
  total: number;
  /** Clip being played. */
  current: string | null;
  message: string | null;
  savedId: string | null;
  /** Bumps after each save so the saved list reloads. */
  savedVersion: number;
}

export const costOf = (t: TurnRecord): number | null =>
  t.usage ? turnCost(t.usage, pricing, (t.providersUsed ?? t.conditions.providers)[1] ?? "") : null;

export class TestRunner {
  private state: RunnerState = { status: "idle", plan: null, done: 0, total: 0, current: null, message: null, savedId: null, savedVersion: 0 };
  private listeners = new Set<() => void>();
  private cancelled = false;

  constructor(private readonly controller: WorkbenchController) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): RunnerState => this.state;

  private set(patch: Partial<RunnerState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** Stop after the turn in progress; the turns so far are saved as a cancelled run. */
  cancel(): void {
    if (this.state.status === "running") {
      this.cancelled = true;
      this.set({ message: "Stopping after this turn…" });
    }
  }

  async start(plan: TestRunPlan): Promise<void> {
    if (this.state.status === "running" || this.state.status === "saving") return;
    const c = this.controller;
    this.cancelled = false;
    this.set({ status: "running", plan, done: 0, total: plan.clips.length * plan.passes, current: null, message: "Setting up…", savedId: null });
    c.lockSetup(true);
    const turns: TurnRecord[] = [];
    try {
      await c.applySetup(SETUPS[plan.setupKey].setup(plan.controls));
      for (let pass = 0; pass < plan.passes && !this.cancelled; pass++) {
        for (const clip of plan.clips) {
          if (this.cancelled) break;
          this.set({ current: clip.id, message: null });
          await c.selectInput(clip.id);
          await c.untilReady();
          const turnId = await c.runReplayTurn(clip.lang);
          if (!turnId) throw new Error(`The turn for ${clip.id} did not start.`);
          await c.untilReady(TURN_DONE_TIMEOUT_MS);
          const rec = c.metrics.get(turnId);
          if (rec) turns.push(structuredClone(rec));
          this.set({ done: this.state.done + 1 });
        }
      }
    } catch (e) {
      this.set({ message: (e as Error).message });
    } finally {
      c.lockSetup(false);
    }
    if (turns.length === 0) {
      this.set({ status: "failed", current: null, message: this.state.message ?? "No turns were recorded." });
      return;
    }
    this.set({ status: "saving", current: null });
    try {
      const info = SETUPS[plan.setupKey];
      const setup = info.setup(plan.controls);
      const byId = Object.fromEntries(plan.clips.map((x) => [x.id, x]));
      const id = await api.saveTestRun({
        name: plan.name,
        status: this.cancelled || turns.length < this.state.total ? "cancelled" : "completed",
        setup: { key: plan.setupKey, label: info.label, mode: setup.mode, strategy: setup.strategy, controls: setup.controls, ...(setup.providers ? { providers: setup.providers } : {}) },
        clips: plan.clips.map((x) => x.id),
        passes: plan.passes,
        pair: c.getSnapshot().pairId,
        build: c.getSnapshot().health?.build ?? "unknown",
        runId: c.runId,
        summary: summarizeRun(turns, byId, plan.setupKey, costOf),
        turns,
      });
      this.set({ status: "saved", savedId: id, message: null, savedVersion: this.state.savedVersion + 1 });
    } catch (e) {
      this.set({ status: "failed", message: (e as Error).message });
    }
  }
}
