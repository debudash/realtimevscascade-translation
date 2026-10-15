import pricingTable from "../../../harness/pricing.json";
import { turnCost, type Pricing } from "../state/cost";
import { accessMs, mouthToEarMs, type MarkName, type TurnRecord } from "../state/metrics";
import type { Mode } from "../state/turnMachine";
import { PROVIDER_LABEL } from "./Transcripts";
import { useController, useSnapshot } from "./useController";

// Side-by-side comparison: the latest completed turn of each mode, with its input, so the same
// replay clip (or the same spoken line) can be read across both architectures.

const pricing = pricingTable as unknown as Pricing;
const MODE_NAME: Record<Mode, string> = { realtime: "Realtime", cascade: "Cascade" };

interface Row {
  label: string;
  /** ms after T0; null = not recorded; "hidden" = Realtime internals. */
  value: number | null | "hidden";
}

const s2 = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(2)} s`);
const between = (t: TurnRecord, from: MarkName, to: MarkName) =>
  t.marks[from] === undefined || t.marks[to] === undefined ? null : t.marks[to]! - t.marks[from]!;

export const inputLabel = (source: string) => (source === "mic" ? "Microphone" : `Replay: ${source}`);

function rows(t: TurnRecord): Row[] {
  const at = (m: MarkName) => between(t, "t0", m);
  if (t.conditions.mode === "realtime") {
    return [
      { label: "Release", value: at("release") },
      { label: "Response start", value: at("rtResponseStart") },
      { label: "STT / LLM / TTS", value: "hidden" },
      { label: "First audible", value: at("firstAudible") },
    ];
  }
  return [
    { label: "Release", value: at("release") },
    { label: "STT final", value: at("sttFinal") },
    { label: "Translate 1st tok", value: at("translateFirstToken") },
    { label: "Translate done", value: at("translateDone") },
    { label: "TTS first byte", value: at("ttsFirstByte") },
    { label: "First audible", value: at("firstAudible") },
  ];
}

function Waterfall({ turn }: { turn: TurnRecord }) {
  const r = rows(turn);
  const max = Math.max(1000, ...r.map((x) => (typeof x.value === "number" ? x.value : 0)));
  const axis = Math.ceil(max / 500) * 500;
  return (
    <div className="waterfall" data-testid="waterfall">
      {r.map((row) => {
        const hidden = row.value === "hidden";
        const v = typeof row.value === "number" ? row.value : null;
        const width = v === null ? 0 : Math.max(0, (v / axis) * 100);
        return (
          <div className="wf-row" key={row.label}>
            <span className="wf-label">{row.label}</span>
            <div className={`wf-track ${hidden ? "wf-track--hidden" : ""}`}>
              {!hidden && v !== null && <div className="wf-bar" style={{ width: `${width}%` }} />}
            </div>
            <span className="wf-value">{hidden ? "hidden" : v !== null && v < 0 ? "during speech" : s2(v)}</span>
          </div>
        );
      })}
      <div className="wf-row" aria-hidden>
        <span />
        <div className="wf-axis">
          <span>0</span>
          <span>{(axis / 2000).toFixed(1)} s</span>
          <span>{(axis / 1000).toFixed(1)} s</span>
        </div>
        <span />
      </div>
    </div>
  );
}

function cost(t: TurnRecord): { usd: number; perMin: number | null } | null {
  if (!t.usage) return null;
  const translation = (t.providersUsed ?? t.conditions.providers)[1] ?? "";
  const usd = turnCost(t.usage, pricing, translation);
  const minutes = t.usage.sttAudioSeconds / 60;
  return { usd, perMin: minutes > 0 ? usd / minutes : null };
}

function Block({ mode, turn, other }: { mode: Mode; turn: TurnRecord | undefined; other: TurnRecord | undefined }) {
  const name = MODE_NAME[mode];
  if (!turn) {
    return (
      <section className={`panel compare__block compare__block--${mode}`} data-testid={`compare-${mode}`}>
        <div className="panel__head">
          <h3 className="compare__mode">{name}</h3>
        </div>
        <p className="secondary">
          No {name} turn yet. Switch to {name} and run the same input to compare.
        </p>
      </section>
    );
  }
  const m2e = mouthToEarMs(turn);
  const otherM2e = other ? mouthToEarMs(other) : null;
  const delta = m2e !== null && otherM2e !== null ? m2e - otherM2e : null;
  const providers = (turn.providersUsed ?? turn.conditions.providers).map((p) => PROVIDER_LABEL[p] ?? p).join(" · ");
  const segments = new Set(turn.stages.filter((s) => s.stage === "translate_first_token").map((s) => s.segment)).size;
  const c = cost(turn);
  const tag = mode === "realtime" ? "REALTIME" : `CASCADE · ${(turn.conditions.strategy ?? "segment").toUpperCase()}`;
  return (
    <section className={`panel compare__block compare__block--${mode}`} data-testid={`compare-${mode}`}>
      <div className="panel__head">
        <span className="tag">{tag}</span>
        <span className="compare__input">{inputLabel(turn.conditions.inputSource)}</span>
        <span className="compare__dir">{turn.conditions.direction.toUpperCase().replace("-", " → ")}</span>
      </div>
      <div className="headline">
        <span className="headline__value" data-testid="headline-latency">
          {s2(m2e)}
        </span>
        <span className="headline__caption">speech end → first audible</span>
        {delta !== null && (
          <span className={`compare__delta ${delta <= 0 ? "compare__delta--faster" : ""}`}>
            {delta <= 0 ? "−" : "+"}
            {(Math.abs(delta) / 1000).toFixed(2)} s vs {MODE_NAME[mode === "realtime" ? "cascade" : "realtime"]}
          </span>
        )}
      </div>
      <dl className="compare__facts">
        <div>
          <dt>Access time</dt>
          <dd>{s2(accessMs(turn))}</dd>
        </div>
        <div>
          <dt>Release lag</dt>
          <dd>{s2(between(turn, "t0", "release"))}</dd>
        </div>
        <div>
          <dt>Release → first audible</dt>
          <dd>{s2(between(turn, "release", "firstAudible"))}</dd>
        </div>
        {mode === "cascade" && (
          <div>
            <dt>Segments committed</dt>
            <dd>{segments || "–"}</dd>
          </div>
        )}
        <div>
          <dt>Turn cost</dt>
          <dd data-testid="turn-cost">{c ? `$${c.usd.toFixed(4)}` : "–"}</dd>
        </div>
        <div>
          <dt>Per minute of speech</dt>
          <dd>{c?.perMin != null ? `$${c.perMin.toFixed(3)}` : "–"}</dd>
        </div>
      </dl>
      <Waterfall turn={turn} />
      <div className="compare__text">
        <p className="card__source">{turn.sourceText || "–"}</p>
        <p className="card__target">{turn.targetText || "–"}</p>
        <p className="secondary small">{providers}</p>
      </div>
    </section>
  );
}

export function ModeComparison() {
  const c = useController();
  const s = useSnapshot();
  void s.metricsVersion; // re-render on metric changes
  const done = c.metrics.all().filter((t) => t.status !== "live" && t.marks.t0 !== undefined);
  const latest = (mode: Mode) => done.find((t) => t.conditions.mode === mode);
  const rt = latest("realtime");
  const cascade = latest("cascade");
  const note =
    rt && cascade
      ? rt.conditions.inputSource === cascade.conditions.inputSource
        ? `Same input in both: ${inputLabel(rt.conditions.inputSource)}.`
        : `Different inputs: ${inputLabel(rt.conditions.inputSource)} (Realtime) vs ${inputLabel(cascade.conditions.inputSource)} (Cascade). Run the same input in both modes for a direct comparison.`
      : null;
  return (
    <section className="compare" aria-label="Compare modes">
      <div className="panel__head">
        <h2 className="section-title">Compare modes · latest turn per mode, final segment from T0</h2>
        <span className="secondary small">T0 = last voiced frame, not release</span>
      </div>
      {note && (
        <p className="compare__note secondary small" data-testid="compare-note">
          {note}
        </p>
      )}
      <div className="compare__grid">
        <Block mode="realtime" turn={rt} other={cascade} />
        <Block mode="cascade" turn={cascade} other={rt} />
      </div>
    </section>
  );
}
