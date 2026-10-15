import { isBusy, type Mode } from "../state/turnMachine";
import type { Strategy } from "../state/metrics";
import { useController, useSnapshot } from "./useController";

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <div className={`segmented ${disabled ? "segmented--dim" : ""}`} role="group" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          disabled={disabled}
          className={value === o.value ? "on" : ""}
          onClick={() => onChange(o.value)}
          data-value={o.value}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function connectionLabel(state: string, kind: string, attempt?: number, max?: number): string {
  if (state === "Connected") return `${kind} connected`;
  if (state === "Reconnecting") return `Reconnecting ${attempt ?? ""}/${max ?? 5}`;
  if (state === "Failed") return "Disconnected";
  return "Connecting";
}

export function Header() {
  const c = useController();
  const s = useSnapshot();
  const busy = isBusy(s.turn.phase);
  // The toggle shows the requested mode; a queued switch lights its target.
  const shownMode: Mode = s.turn.pendingMode ?? s.turn.mode;
  const completed = s.metricsVersion >= 0 ? c.metrics.completedCount() : 0;

  return (
    <header className="header">
      <div className="header__brand">
        <img src="/boostlingo-logo.png" alt="Boostlingo" width={152} height={28} />
        <span className="divider" aria-hidden />
        <div>
          <h1>Interpreter Workbench</h1>
          <p className="header__sub">Candidate take-home · not an official Boostlingo product · {completed} turns this session</p>
        </div>
      </div>
      <div className="header__controls">
        <Segmented<Mode>
          label="Mode"
          testId="mode-toggle"
          value={shownMode}
          onChange={(m) => c.switchMode(m)}
          options={[
            { value: "realtime", label: "Realtime" },
            { value: "cascade", label: "Cascade" },
          ]}
        />
        <Segmented<Strategy>
          label="Commit policy"
          testId="commit-toggle"
          value={s.strategy}
          disabled={s.turn.mode === "realtime" || busy}
          onChange={(v) => c.setStrategy(v)}
          options={[
            { value: "segment", label: "Segment" },
            { value: "clause", label: "Clause" },
          ]}
        />
        <select aria-label="Language pair" value={s.pairId} disabled={busy} onChange={(e) => void c.setPair(e.target.value)} data-testid="pair-select">
          {s.config?.pairs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <select aria-label="Input" value={s.input} disabled={busy} onChange={(e) => void c.selectInput(e.target.value)} data-testid="input-select">
          <option value="mic">Microphone</option>
          {s.clips.map((clip) => (
            <option key={clip.id} value={clip.id}>
              Replay: {clip.id}
            </option>
          ))}
        </select>
        <span className={`pill pill--${s.connection.state.toLowerCase()}`} data-testid="connection-pill" role="status">
          <span className="pill__dot" aria-hidden />
          {connectionLabel(s.connection.state, s.connection.kind, s.connection.attempt, s.connection.maxAttempts)}
        </span>
      </div>
    </header>
  );
}
