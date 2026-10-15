import type { ProviderSet } from "./contracts/events";

export interface Health {
  status: string;
  /** Short git sha the server was built from ("unknown" if not stamped). */
  build?: string;
  configOk: boolean;
  /** Names of missing variables (never values). */
  missing: string[];
  /** Missing variables that block each mode (DeepL is optional: it is only the failover). */
  missingByMode?: Record<"realtime" | "cascade", string[]>;
  providers: ProviderSet;
}

export interface LanguageInfo {
  code: string;
  name: string;
  nativeName: string;
  speakerLabel: string;
}

export interface PairInfo {
  id: string;
  a: string;
  b: string;
  label: string;
}

export interface AppConfig {
  defaultPair: string;
  pairs: PairInfo[];
  languages: LanguageInfo[];
  providers: ProviderSet;
  /** Translation controls (formal register + clinic glossary) default. */
  translationControls?: { enabled: boolean };
}

export interface ClipInfo {
  id: string;
  lang: string;
  text: string;
  /** Target language and reference translation from harness/scripts.json (absent for test fixtures). */
  target?: string | null;
  reference?: string | null;
  /** Audio length from the WAV header, for Test Run estimates. */
  durationSeconds?: number | null;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return (await res.json()) as T;
}

/** A saved Test Run as listed (turns left out); the full file adds `turns`. */
export interface SavedTestRun {
  id: string;
  name: string;
  createdAt: string;
  status: "completed" | "cancelled";
  setup: { key: string; label: string; mode: "realtime" | "cascade"; strategy: string; controls: boolean; providers?: Record<string, string> };
  clips: string[];
  passes: number;
  pair: string;
  build: string;
  runId: string;
  summary: import("./session/testRun").TestRunSummary;
  turns?: import("./state/metrics").TurnRecord[];
}

export const api = {
  health: () => getJson<Health>("/api/health"),
  config: () => getJson<AppConfig>("/api/config"),
  clips: () => getJson<ClipInfo[]>("/api/clips"),
  testRuns: () => getJson<SavedTestRun[]>("/api/test-runs"),
  testRun: (id: string) => getJson<SavedTestRun>(`/api/test-runs/${encodeURIComponent(id)}`),
  async saveTestRun(run: Omit<SavedTestRun, "id" | "createdAt">): Promise<string> {
    const res = await fetch("/api/test-runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(run) });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || !body.id) throw new Error(body.error ?? `Saving the test run failed (HTTP ${res.status}).`);
    return body.id;
  },
};
