import { useEffect } from "react";
import { useController, useSnapshot } from "./useController";

const MODE_NAME = { realtime: "Realtime", cascade: "Cascade" } as const;

/** Queued mid-turn mode switch. */
export function PendingSwitchBanner() {
  const c = useController();
  const s = useSnapshot();
  const pending = s.turn.pendingMode;
  if (!pending) return null;
  return (
    <div className="banner banner--info" role="status" data-testid="pending-switch">
      <span>Switching to {MODE_NAME[pending]} after this turn finishes playing. Transcripts are kept.</span>
      <button type="button" className="btn" onClick={() => c.stayOnCurrent()}>
        Stay on {MODE_NAME[s.turn.mode]}
      </button>
    </div>
  );
}

/** socket_drop: reconnecting banner; talk buttons are disabled (Error state) until recovery. */
export function ConnectionBanner() {
  const s = useSnapshot();
  const e = s.sessionError;
  if (e?.code !== "socket_drop") return null;
  const failed = s.connection.state === "Failed";
  return (
    <div className="banner banner--error" role="alert" data-testid="socket-drop">
      <strong>{failed ? "Connection lost." : `Connection lost. Reconnecting, attempt ${e.attempt ?? 1} of ${e.maxAttempts ?? 5}`}</strong>
      <span>{failed ? e.message : "The turn in progress was cancelled. Transcripts so far are kept."}</span>
    </div>
  );
}

/** mic_denied: blocking panel with a way forward. */
export function MicDeniedPanel() {
  const c = useController();
  const s = useSnapshot();
  if (s.sessionError?.code !== "mic_denied") return null;
  const firstClip = s.clips[0]?.id;
  return (
    <section className="panel blocking" role="alertdialog" aria-labelledby="mic-denied-title" data-testid="mic-denied">
      <h2 id="mic-denied-title">Microphone access is blocked</h2>
      <p className="secondary">
        Allow the microphone in your browser's site settings for localhost, then reload. You can still run sessions with recorded clips.
      </p>
      <div className="row">
        <button type="button" className="btn btn--primary" disabled={!firstClip} onClick={() => firstClip && void c.selectInput(firstClip)}>
          Use replay clips
        </button>
        <button type="button" className="btn" onClick={() => void c.selectInput("mic")}>
          Try again
        </button>
      </div>
    </section>
  );
}

/** internal (session-level) errors that are not covered by a specific panel. */
export function SessionErrorBanner() {
  const s = useSnapshot();
  const e = s.sessionError;
  if (!e || ["socket_drop", "mic_denied", "config_error"].includes(e.code)) return null;
  const title = e.code === "rate_limited" ? "Provider busy" : e.code === "provider_timeout" ? "Provider timed out" : "Could not start the session";
  return (
    <div className="banner banner--error" role="alert" data-testid="session-error">
      <strong>{title}</strong>
      <span>
        {e.message} ({e.code}). Switch mode or reload to retry.
      </span>
    </div>
  );
}

/** rate_limited / failover toast. Auto-dismisses after 8 s. */
export function Toast() {
  const c = useController();
  const s = useSnapshot();
  const t = s.toast;
  useEffect(() => {
    if (!t) return;
    const id = setTimeout(() => c.dismissToast(), 8000);
    return () => clearTimeout(id);
  }, [t, c]);
  if (!t) return null;
  return (
    <div className="toast" role="status" aria-live="polite" data-testid="toast">
      <div>
        <strong>{t.title}</strong>
        <p>{t.body}</p>
      </div>
      <button type="button" className="toast__close" aria-label="Dismiss" onClick={() => c.dismissToast()}>
        ×
      </button>
    </div>
  );
}
