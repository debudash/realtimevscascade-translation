import { useEffect, useState } from "react";
import { WorkbenchController } from "./session/controller";
import type { Mode } from "./state/turnMachine";
import { createTransportFactory } from "./transports/factory";
import { ConfigErrorPanel } from "./ui/ConfigErrorPanel";
import { SpeakerStage } from "./ui/SpeakerStage";
import { Header } from "./ui/Header";
import { Transcripts } from "./ui/Transcripts";
import { ControllerContext, useSnapshot } from "./ui/useController";

declare global {
  interface Window {
    /** Test and harness hook: read metrics, drive replay, force a drop. */
    __workbench?: WorkbenchController;
  }
}

function parseProviders(params: URLSearchParams): Record<string, string> | undefined {
  const p = params.get("providers");
  if (!p) return undefined;
  if (p === "fake") return { stt: "fake", translation: "fake", translationFallback: "fake", tts: "fake" };
  // e.g. ?providers=translation:deepl,tts:elevenlabs
  return Object.fromEntries(p.split(",").map((kv) => kv.split(":") as [string, string]));
}

/** One controller per page load, created outside React so StrictMode's double render can't fork it. */
function createController(): WorkbenchController {
  const params = new URLSearchParams(window.location.search);
  const mode = (params.get("mode") as Mode | null) ?? "cascade";
  const c = new WorkbenchController(createTransportFactory(params), mode, parseProviders(params));
  window.__workbench = c;
  return c;
}

const controller = createController();

export function App() {
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    controller.start().catch((e: Error) => setStartError(e.message));
  }, [controller]);

  return (
    <ControllerContext.Provider value={controller}>
      <Shell startError={startError} />
    </ControllerContext.Provider>
  );
}

function Shell({ startError }: { startError: string | null }) {
  const s = useSnapshot();
  const missing = s.sessionError?.code === "config_error" ? (s.health?.missing ?? []) : [];

  return (
    <div className={`app app--${s.turn.mode}`}>
      <Header />
      <main className="main">
        {startError && (
          <p className="banner banner--error" role="alert">
            Backend unreachable: {startError}
          </p>
        )}
        {missing.length > 0 && <ConfigErrorPanel missing={missing} />}
        <div className="columns">
          <SpeakerStage />
          <Transcripts />
        </div>
      </main>
    </div>
  );
}
