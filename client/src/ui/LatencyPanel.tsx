import { summarize, type ConfigKey } from "../state/metrics";
import { useController, useSnapshot } from "./useController";

const ROW_LABEL: Record<ConfigKey, string> = {
  realtime: "Realtime",
  "cascade-segment": "Cascade · segment",
  "cascade-clause": "Cascade · clause",
};

const s2 = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(2)} s`);

export function LatencyPanel() {
  const c = useController();
  const s = useSnapshot();
  void s.metricsVersion;
  const turns = c.metrics.all();
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

