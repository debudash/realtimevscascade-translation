import { mouthToEarMs, type TurnRecord } from "../state/metrics";
import type { LiveTurnView } from "../session/controller";
import { useController, useSnapshot } from "./useController";

const PROVIDER_LABEL: Record<string, string> = {
  deepgram: "Deepgram",
  openai: "OpenAI",
  elevenlabs: "ElevenLabs",
  deepl: "DeepL",
  fake: "Fake",
  "gpt-realtime": "gpt-realtime",
};

function tag(mode: string, strategy: string | null): string {
  return mode === "realtime" ? "REALTIME" : `CASCADE · ${(strategy ?? "segment").toUpperCase()}`;
}

function arrow(direction: string): string {
  return direction.toUpperCase().replace("-", " → ");
}

function LiveCard({ live }: { live: LiveTurnView }) {
  return (
    <article className={`card card--live card--${live.mode}`} data-testid="live-turn" aria-live="polite">
      <header className="card__head">
        <span className="tag">{tag(live.mode, live.strategy)}</span>
        <span className="card__dir">{arrow(`${live.source}-${live.target}`)}</span>
        <span className="live-dot">LIVE</span>
      </header>
      <p className="card__source" lang={live.source}>
        <span>{live.sourceStable}</span> <span className="partial">{live.sourcePartial}</span>
      </p>
      <p className="card__target" lang={live.target}>
        {live.targetText}
        <span className="caret" aria-hidden />
      </p>
    </article>
  );
}

function TurnCard({ turn, n }: { turn: TurnRecord; n: number }) {
  const c = useController();
  const m2e = mouthToEarMs(turn);
  const [src, tgt] = turn.conditions.direction.split("-");
  const providers = (turn.providersUsed ?? turn.conditions.providers).map((p) => PROVIDER_LABEL[p] ?? p).join(" · ");
  return (
    <article className={`card card--${turn.conditions.mode}`} data-testid="turn-card" data-status={turn.status}>
      <header className="card__head">
        <span className="tag">{tag(turn.conditions.mode, turn.conditions.strategy)}</span>
        <span className="card__dir">
          turn {n} · {arrow(turn.conditions.direction)}
        </span>
        {m2e !== null && turn.status === "completed" && <span className="badge">first audio {(m2e / 1000).toFixed(2)} s</span>}
      </header>
      {turn.status === "empty" && <p className="card__note">No speech detected. Hold the button while you talk.</p>}
      {turn.status === "cancelled" && <p className="card__note">Cancelled.</p>}
      {turn.sourceText && (
        <p className="card__source" lang={src} data-testid="source-text">
          {turn.sourceText}
        </p>
      )}
      {turn.targetText && (
        <p className="card__target" lang={tgt} data-testid="target-text">
          {turn.targetText}
        </p>
      )}
      {turn.error && turn.status === "failed" && <TurnError turn={turn} onRetry={() => c.retryTurn(turn.turnId)} />}
      <footer className="card__foot">
        <span>{providers}</span>
        {turn.conditions.controls !== undefined && (
          <span data-testid="controls-tag">{turn.conditions.controls ? "Clinic terms on" : "Clinic terms off"}</span>
        )}
        {turn.failoverNote && <span className="failover">Failover: {turn.failoverNote}</span>}
      </footer>
    </article>
  );
}

const STAGE_NAME: Record<string, string> = { stt: "speech-to-text", translation: "translation", tts: "speech synthesis" };

/** provider_timeout / provider_error / internal shown inline on the turn card. */
function TurnError({ turn, onRetry }: { turn: TurnRecord; onRetry: () => void }) {
  const e = turn.error!;
  const stage = e.stage ? (STAGE_NAME[e.stage] ?? e.stage) : "the provider";
  if (e.code === "internal") {
    return (
      <div className="card__error" role="alert">
        Something went wrong (turn {turn.turnId}). {e.message}
      </div>
    );
  }
  const title = e.code === "provider_timeout" ? `Timed out at ${stage}` : `Provider error at ${stage}${e.httpStatus ? ` (HTTP ${e.httpStatus})` : ""}`;
  return (
    <div className="card__error" role="alert" data-testid="turn-error">
      <strong>{title}</strong>
      <span>{e.message}</span>
      <button type="button" className="btn" onClick={onRetry} data-testid="retry-turn">
        Retry turn
      </button>
    </div>
  );
}

export function Transcripts() {
  const c = useController();
  const s = useSnapshot();
  void s.metricsVersion; // re-render on metric changes
  const all = c.metrics.all();
  const turns = all.filter((t) => t.turnId !== s.live?.turnId);
  const number = (id: string) => all.length - all.findIndex((t) => t.turnId === id);
  return (
    <section className="transcripts" aria-label="Live transcripts">
      <div className="panel__head">
        <h2 className="section-title">Live transcripts</h2>
        <span className="secondary small">newest first</span>
      </div>
      {s.live && <LiveCard live={s.live} />}
      {turns.length === 0 && !s.live && <p className="secondary empty">Turns appear here, newest first.</p>}
      {turns.map((t) => (
        <TurnCard key={t.turnId} turn={t} n={number(t.turnId)} />
      ))}
    </section>
  );
}
