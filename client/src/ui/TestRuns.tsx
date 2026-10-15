import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import costTable from "../../../harness/results/cost-per-minute.json";
import { api, type ClipInfo, type SavedTestRun } from "../api";
import { compareRuns, estimate, SETUPS, type PlannedClip, type SetupKey, type TestRunSummary } from "../session/testRun";
import type { TestRunner } from "../session/TestRunner";
import { mouthToEarMs, accessMs, type TurnRecord } from "../state/metrics";
import { inputLabel } from "./ModeComparison";
import { useSnapshot } from "./useController";

// Test Runs tab: build a run from chosen replay clips and one setup, run it, and keep every run.

const RATE: Record<string, number> = (costTable as { usdPerMinute: Record<string, number> }).usdPerMinute;
const SETUP_KEYS = Object.keys(SETUPS) as SetupKey[];
type Utterances = "all" | "en" | "es" | "pick";

const s2 = (ms: number | null | undefined) => (ms == null ? "–" : `${(ms / 1000).toFixed(2)} s`);
const usd = (x: number | null | undefined, d = 4) => (x == null ? "–" : `$${x.toFixed(d)}`);
const pct = (x: number | null | undefined) => (x == null ? "–" : `${(x * 100).toFixed(1)}%`);
const duration = (s: number) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
const when = (iso: string) => new Date(iso).toLocaleString();

function planned(c: ClipInfo): PlannedClip | null {
  if (!c.target || !c.reference || !c.durationSeconds) return null;
  return { id: c.id, lang: c.lang, target: c.target, text: c.text, reference: c.reference, durationSeconds: c.durationSeconds };
}

function defaultName(): string {
  return `Test run ${new Date().toLocaleString()}`;
}

function NewRun({ runner }: { runner: TestRunner }) {
  const s = useSnapshot();
  const state = useSyncExternalStore(runner.subscribe, runner.getState);
  const pair = s.config?.pairs.find((p) => p.id === s.pairId);
  const clips = useMemo(
    () => s.clips.map(planned).filter((c): c is PlannedClip => !!c && !!pair && [pair.a, pair.b].includes(c.lang) && [pair.a, pair.b].includes(c.target)),
    [s.clips, pair],
  );
  const [name, setName] = useState(defaultName);
  const [setupKey, setSetupKey] = useState<SetupKey>("realtime");
  const [controls, setControls] = useState(true);
  const [utterances, setUtterances] = useState<Utterances>("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [passes, setPasses] = useState(1);
  const [confirming, setConfirming] = useState(false);

  const chosen = clips.filter((c) => (utterances === "all" ? true : utterances === "pick" ? picked.has(c.id) : c.lang === utterances));
  const fakes = ["stt", "translation", "tts"].every((k) => s.providerOverride?.[k] === "fake");
  const rate = setupKey === "realtime" || !fakes ? (RATE[setupKey] ?? null) : 0;
  const est = estimate(chosen, passes, rate);
  const running = state.status === "running" || state.status === "saving";
  const canStart = !running && chosen.length > 0 && name.trim().length > 0 && s.turn.phase === "Ready";

  const toggle = (id: string) => setPicked((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set([...p, id])));
  const start = () => {
    setConfirming(false);
    void runner.start({ name: name.trim(), setupKey, controls, clips: chosen, passes });
  };
  useEffect(() => {
    if (state.status === "saved") setName(defaultName());
  }, [state.savedVersion, state.status]);

  return (
    <section className="panel tr-form" aria-label="New test run">
      <h2 className="section-title">New test run</h2>
      <label className="tr-field">
        <span>Name</span>
        <input id="tr-name" value={name} onChange={(e) => setName(e.target.value)} disabled={running} />
      </label>

      <fieldset className="tr-group" disabled={running}>
        <legend>Setup (one per run)</legend>
        {SETUP_KEYS.map((k) => (
          <label key={k} className="tr-option">
            <input type="radio" id={`tr-setup-${k}`} name="tr-setup" checked={setupKey === k} onChange={() => setSetupKey(k)} aria-label={SETUPS[k].label} />
            <span>
              <b>{SETUPS[k].label}</b> <span className="secondary">{SETUPS[k].detail}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="tr-group tr-inline" disabled={running} data-testid="clinic-terms">
        <legend>Clinic terms</legend>
        <label className="tr-option">
          <input type="radio" id="tr-controls-on" name="tr-controls" checked={controls} onChange={() => setControls(true)} aria-label="On" /> On
        </label>
        <label className="tr-option">
          <input type="radio" id="tr-controls-off" name="tr-controls" checked={!controls} onChange={() => setControls(false)} aria-label="Off" /> Off
        </label>
      </fieldset>

      <fieldset className="tr-group" disabled={running}>
        <legend>Utterances</legend>
        <div className="tr-inline">
          {(
            [
              ["all", `All (${clips.length})`],
              ["en", `English (${clips.filter((c) => c.lang === "en").length})`],
              ["es", `Spanish (${clips.filter((c) => c.lang === "es").length})`],
              ["pick", "Pick clips"],
            ] as [Utterances, string][]
          ).map(([v, label]) => (
            <label key={v} className="tr-option">
              <input type="radio" id={`tr-utt-${v}`} name="tr-utterances" checked={utterances === v} onChange={() => setUtterances(v)} aria-label={label} /> {label}
            </label>
          ))}
        </div>
        {utterances === "pick" && (
          <div className="tr-clips">
            {clips.map((c) => (
              <label key={c.id} className="tr-option tr-clip">
                <input type="checkbox" id={`tr-clip-${c.id}`} data-testid={`clip-${c.id}`} checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
                <span className="tr-clip__id">{c.id}</span>
                <span className="tr-clip__text">{c.text}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <label className="tr-field tr-passes">
        <span>Passes</span>
        <input id="tr-passes" type="number" min={1} max={3} value={passes} disabled={running} onChange={(e) => setPasses(Math.min(3, Math.max(1, Number(e.target.value) || 1)))} />
      </label>

      <p className="tr-estimate" data-testid="estimate">
        <b>{est.turns} turns</b> · {(est.voicedSeconds / 60).toFixed(2)} voiced min · about {duration(est.seconds)} ·{" "}
        {fakes && setupKey !== "realtime" ? "fake providers, no API cost" : est.usd === null ? "no measured rate yet" : `about ${usd(est.usd, 3)}`}
      </p>
      <p className="secondary small">Estimate: press-to-release minutes × the measured cost per minute from the evaluation report.</p>

      {!confirming ? (
        <div className="tr-actions">
          <button type="button" className="btn btn--primary" disabled={!canStart} onClick={() => setConfirming(true)}>
            Start
          </button>
          {running && (
            <button type="button" className="btn" onClick={() => runner.cancel()}>
              Cancel
            </button>
          )}
        </div>
      ) : (
        <div className="tr-confirm" role="group" aria-label="Confirm the run">
          <span>
            Run {est.turns} turns on {SETUPS[setupKey].label}
            {fakes && setupKey !== "realtime" ? "" : est.usd !== null ? `, about ${usd(est.usd, 3)} in API usage` : ""}?
          </span>
          <button type="button" className="btn btn--primary" onClick={start}>
            Start run
          </button>
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            Back
          </button>
        </div>
      )}

      <RunStatus runner={runner} />
    </section>
  );
}

function RunStatus({ runner }: { runner: TestRunner }) {
  const st = useSyncExternalStore(runner.subscribe, runner.getState);
  if (st.status === "idle") return null;
  const share = st.total ? (100 * st.done) / st.total : 0;
  return (
    <div className="tr-status" data-testid="run-status" role="status">
      {(st.status === "running" || st.status === "saving") && (
        <>
          <div className="tr-bar">
            <i style={{ width: `${share}%` }} />
          </div>
          <span>
            {st.status === "saving" ? "Saving…" : `${st.done} of ${st.total}${st.current ? ` · ${inputLabel(st.current)}` : ""}`}
            {st.message ? ` · ${st.message}` : ""}
          </span>
        </>
      )}
      {st.status === "saved" && <span className="tr-ok">Saved: {st.plan?.name}</span>}
      {st.status === "failed" && <span className="tr-bad">Not saved: {st.message}</span>}
    </div>
  );
}

function SummaryFacts({ s }: { s: TestRunSummary }) {
  return (
    <dl className="compare__facts">
      <div>
        <dt>Mouth-to-ear p50 / p95</dt>
        <dd>
          {s2(s.p50Ms)} / <span className={s.meetsTarget === null ? "" : s.meetsTarget ? "ok" : "bad"}>{s2(s.p95Ms)}</span>
        </dd>
      </div>
      <div>
        <dt>Target (p95)</dt>
        <dd>&lt; {s2(s.targetMs)}</dd>
      </div>
      <div>
        <dt>Turns completed</dt>
        <dd>
          {s.completed} / {s.turns}
        </dd>
      </div>
      <div>
        <dt>Access p50</dt>
        <dd>{s2(s.accessP50Ms)}</dd>
      </div>
      <div>
        <dt>Release → first audible p50</dt>
        <dd>{s2(s.releaseToAudibleP50Ms)}</dd>
      </div>
      <div>
        <dt>Source / target WER</dt>
        <dd>
          {pct(s.sourceWer)} / {pct(s.targetWer)}
        </dd>
      </div>
      <div>
        <dt>Cost</dt>
        <dd>{usd(s.costUsd)}</dd>
      </div>
      <div>
        <dt>Per minute of speech</dt>
        <dd>{usd(s.usdPerMinute, 3)}</dd>
      </div>
    </dl>
  );
}

function exportJson(run: SavedTestRun) {
  const blob = new Blob([JSON.stringify(run, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: `${run.id}.json` }).click();
  URL.revokeObjectURL(url);
}

function Detail({ run, onClose }: { run: SavedTestRun; onClose: () => void }) {
  return (
    <section className="panel tr-detail" data-testid="run-detail" aria-label={`Test run ${run.name}`}>
      <div className="panel__head">
        <h2 className="section-title">{run.name}</h2>
        <span className="secondary small">
          {run.setup.label} · Clinic terms {run.setup.controls ? "on" : "off"} · {when(run.createdAt)} · build {run.build}
          {run.status === "cancelled" ? " · cancelled" : ""}
        </span>
      </div>
      <SummaryFacts s={run.summary} />
      <div className="tr-table-wrap">
        <table className="tr-table">
          <thead>
            <tr>
              <th scope="col">Clip</th>
              <th scope="col">Status</th>
              <th scope="col">Mouth-to-ear</th>
              <th scope="col">Access</th>
              <th scope="col">Source</th>
              <th scope="col">Interpretation</th>
            </tr>
          </thead>
          <tbody>
            {(run.turns ?? []).map((t: TurnRecord) => (
              <tr key={t.turnId} data-testid="run-turn">
                <td className="mono">{t.conditions.inputSource}</td>
                <td>{t.status}</td>
                <td className="mono">{s2(mouthToEarMs(t))}</td>
                <td className="mono">{s2(accessMs(t))}</td>
                <td>{t.sourceText}</td>
                <td>{t.targetText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tr-actions">
        <button type="button" className="btn" onClick={() => exportJson(run)}>
          Export JSON
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </section>
  );
}

function Compare({ a, b, onClose }: { a: SavedTestRun; b: SavedTestRun; onClose: () => void }) {
  const deltas = compareRuns(a.turns ?? [], b.turns ?? []);
  const row = (label: string, f: (s: TestRunSummary) => string) => (
    <tr>
      <th scope="row">{label}</th>
      <td className="mono">{f(a.summary)}</td>
      <td className="mono">{f(b.summary)}</td>
    </tr>
  );
  return (
    <section className="panel tr-detail" data-testid="run-compare" aria-label="Compare test runs">
      <div className="panel__head">
        <h2 className="section-title">Compare test runs</h2>
        <span className="secondary small">B minus A: positive means B was slower</span>
      </div>
      <div className="tr-table-wrap">
        <table className="tr-table">
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col">A · {a.name}</th>
              <th scope="col">B · {b.name}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Setup</th>
              <td>{a.setup.label}</td>
              <td>{b.setup.label}</td>
            </tr>
            {row("Mouth-to-ear p50", (s) => s2(s.p50Ms))}
            {row("Mouth-to-ear p95", (s) => s2(s.p95Ms))}
            {row("Access p50", (s) => s2(s.accessP50Ms))}
            {row("Release → first audible p50", (s) => s2(s.releaseToAudibleP50Ms))}
            {row("Source / target WER", (s) => `${pct(s.sourceWer)} / ${pct(s.targetWer)}`)}
            {row("Per minute of speech", (s) => usd(s.usdPerMinute, 3))}
          </tbody>
        </table>
      </div>
      <h3 className="tr-sub">Per clip (mean mouth-to-ear)</h3>
      {deltas.length === 0 ? (
        <p className="secondary">These runs have no clips in common.</p>
      ) : (
        <div className="tr-table-wrap">
          <table className="tr-table">
            <thead>
              <tr>
                <th scope="col">Clip</th>
                <th scope="col">A</th>
                <th scope="col">B</th>
                <th scope="col">B − A</th>
              </tr>
            </thead>
            <tbody>
              {deltas.map((d) => (
                <tr key={d.clip} data-testid="clip-delta">
                  <td className="mono">{d.clip}</td>
                  <td className="mono">{s2(d.aMs)}</td>
                  <td className="mono">{s2(d.bMs)}</td>
                  <td className={`mono ${d.deltaMs > 0 ? "bad" : "ok"}`}>
                    {d.deltaMs > 0 ? "+" : "−"}
                    {(Math.abs(d.deltaMs) / 1000).toFixed(2)} s
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="tr-actions">
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </section>
  );
}

function Saved({ runner }: { runner: TestRunner }) {
  const st = useSyncExternalStore(runner.subscribe, runner.getState);
  const [runs, setRuns] = useState<SavedTestRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [view, setView] = useState<{ kind: "detail"; run: SavedTestRun } | { kind: "compare"; a: SavedTestRun; b: SavedTestRun } | null>(null);

  useEffect(() => {
    api.testRuns().then(setRuns, (e: Error) => setError(e.message));
  }, [st.savedVersion]);

  const open = async (id: string) => setView({ kind: "detail", run: await api.testRun(id) });
  const compare = async () => {
    const [a, b] = await Promise.all(selected.map((id) => api.testRun(id)));
    setView({ kind: "compare", a, b });
  };
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-2)));

  return (
    <div className="tr-saved">
      <section className="panel" aria-label="Saved test runs">
        <div className="panel__head">
          <h2 className="section-title">Saved test runs</h2>
          <button type="button" className="btn" disabled={selected.length !== 2} onClick={() => void compare()}>
            Compare selected
          </button>
        </div>
        {error && <p className="tr-bad">Could not load saved runs: {error}</p>}
        {runs && runs.length === 0 && <p className="secondary">No test runs yet. Start one on the left; each run is saved to harness/results/test-runs/.</p>}
        {runs && runs.length > 0 && (
          <div className="tr-table-wrap">
            <table className="tr-table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Select</span>
                  </th>
                  <th scope="col">Name</th>
                  <th scope="col">Setup</th>
                  <th scope="col">Turns</th>
                  <th scope="col">p50</th>
                  <th scope="col">p95</th>
                  <th scope="col">Cost</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} data-testid="saved-run">
                    <td>
                      <input type="checkbox" id={`tr-sel-${r.id}`} aria-label={`Select ${r.name}`} checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                    <td>
                      <button type="button" className="linkish" onClick={() => void open(r.id)}>
                        {r.name}
                      </button>
                      {r.status === "cancelled" && <span className="secondary small"> (cancelled)</span>}
                    </td>
                    <td>
                      {r.setup.label}
                      <span className="secondary small"> · terms {r.setup.controls ? "on" : "off"}</span>
                    </td>
                    <td className="mono">{r.summary.completed}</td>
                    <td className="mono">{s2(r.summary.p50Ms)}</td>
                    <td className={`mono ${r.summary.meetsTarget === null ? "" : r.summary.meetsTarget ? "ok" : "bad"}`}>{s2(r.summary.p95Ms)}</td>
                    <td className="mono">{usd(r.summary.costUsd)}</td>
                    <td className="small">{when(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {view?.kind === "detail" && <Detail run={view.run} onClose={() => setView(null)} />}
      {view?.kind === "compare" && <Compare a={view.a} b={view.b} onClose={() => setView(null)} />}
    </div>
  );
}

export function TestRuns({ runner }: { runner: TestRunner }) {
  return (
    <div className="tr">
      <NewRun runner={runner} />
      <Saved runner={runner} />
    </div>
  );
}
