import { accessMs, mouthToEarMs, summarize, type ConfigKey, type MarkName, type TurnRecord } from "../state/metrics";
import { useController, useSnapshot } from "./useController";

const ROW_LABEL: Record<ConfigKey, string> = {
  realtime: "Realtime",
  "cascade-segment": "Cascade · segment",
  "cascade-clause": "Cascade · clause",
};

interface Row {
  label: string;
  /** ms after T0; null = not recorded; "hidden" = Realtime internals. */
  value: number | null | "hidden";
}

function rows(t: TurnRecord): Row[] {
  const t0 = t.marks.t0;
  const at = (m: MarkName): number | null => (t0 === undefined || t.marks[m] === undefined ? null : t.marks[m]! - t0);
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
    { label: "TTS first byte", value: at("ttsFirstByte") },
    { label: "First audible", value: at("firstAudible") },
  ];
}

const s2 = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(2)} s`);

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

export function LatencyPanel() {
  const c = useController();
  const s = useSnapshot();
  void s.metricsVersion;
  const turns = c.metrics.all();
  const last = turns.find((t) => t.status !== "live" && t.marks.t0 !== undefined);
  const headline = last ? mouthToEarMs(last) : null;
  const summary = summarize(turns);

  const exportMetrics = () => {
    const blob = new Blob([c.exportMetrics()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: `workbench-session-${new Date().toISOString().replace(/[:.]/g, "-")}.json` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside className="latency" aria-label="Latency">
      <section className="panel">
        <div className="panel__head">
          <h2 className="section-title">Last turn · final segment from T0</h2>
          {last && <span className="tag">{last.conditions.mode === "realtime" ? "REALTIME" : `CASCADE · ${(last.conditions.strategy ?? "segment").toUpperCase()}`}</span>}
        </div>
        <div className="headline">
          <span className="headline__value" data-testid="headline-latency">
            {headline === null ? "–" : s2(headline)}
          </span>
          <span className="headline__caption">speech end → first audible</span>
        </div>
        <div className="headline__meta">
          <span>T0 = last voiced frame, not release</span>
          <span>
            Access time <b>{last ? s2(accessMs(last)) : "–"}</b>
          </span>
        </div>
        {last ? <Waterfall turn={last} /> : <p className="secondary">Complete a turn to see its stage timings.</p>}
      </section>

      <section className="panel">
        <h2 className="section-title">Session p50 / p95</h2>
        <table className="summary" data-testid="summary-table">
          <thead>
            <tr>
              <th scope="col">Mode</th>
              <th scope="col">n</th>
              <th scope="col">p50</th>
              <th scope="col">p95</th>
              <th scope="col">Target</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((row) => (
              <tr key={row.key} data-key={row.key}>
                <td>{ROW_LABEL[row.key]}</td>
                <td>{row.n}</td>
                <td>{s2(row.p50)}</td>
                <td>{s2(row.p95)}</td>
                <td className={row.meetsTarget === null ? "" : row.meetsTarget ? "ok" : "bad"}>&lt; {(row.targetMs / 1000).toFixed(1)} s</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="secondary small">Mouth-to-ear over completed turns. Cascade · clause is held to the 2.0 s stretch target.</p>
        <button type="button" className="btn" onClick={exportMetrics} data-testid="export-metrics">
          Export session metrics
        </button>
      </section>
    </aside>
  );
}

