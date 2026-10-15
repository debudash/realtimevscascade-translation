import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../scripts/env.mjs";

export const harnessDir = join(repoRoot, "harness");
/** Baseline results live in harness/results; HARNESS_RESULTS_DIR (e.g. results-controls) selects another folder. */
export const baselineResultsDir = join(harnessDir, "results");
export const resultsDir = join(harnessDir, process.env.HARNESS_RESULTS_DIR ?? "results");
export const runsDir = join(resultsDir, "runs");

export interface ScriptClip {
  id: string;
  lang: string;
  target: string;
  text: string;
  reference: string;
  question?: boolean;
  pair?: string;
}

export interface Scripts {
  clips: ScriptClip[];
}

export function loadScripts(): Scripts {
  return JSON.parse(readFileSync(join(harnessDir, "scripts.json"), "utf8"));
}

/**
 * The four baseline configurations: URL only, no code changes (provider flexibility evidence).
 * They pin controls=off: the baseline runs predate the translation controls, which now default on.
 */
export const CONFIGS: Record<string, { url: string; label: string }> = {
  realtime: { url: "/?mode=realtime&controls=off", label: "Realtime (gpt-realtime)" },
  "cascade-segment": { url: "/?controls=off", label: "Cascade · segment (Deepgram · OpenAI · ElevenLabs)" },
  "cascade-clause": { url: "/?strategy=clause&controls=off", label: "Cascade · clause (Deepgram · OpenAI · ElevenLabs)" },
  "cascade-deepl": { url: "/?providers=translation:deepl&controls=off", label: "Cascade · segment, DeepL primary (Deepgram · DeepL · ElevenLabs)" },
};

/** The same pipelines with translation controls on (formal register + clinic glossary). */
export const CONTROL_CONFIGS: Record<string, { url: string; label: string; baseline: string }> = {
  "realtime-controls": { url: "/?mode=realtime&controls=on", label: "Realtime + controls (prompt only)", baseline: "realtime" },
  "cascade-segment-controls": { url: "/?controls=on", label: "Cascade · segment + controls (OpenAI prompt)", baseline: "cascade-segment" },
  "cascade-deepl-controls": { url: "/?providers=translation:deepl&controls=on", label: "Cascade · DeepL + controls (formality + glossary)", baseline: "cascade-deepl" },
};

export const ALL_CONFIGS: Record<string, { url: string; label: string }> = { ...CONFIGS, ...CONTROL_CONFIGS };

/** Cost guardrail (CLAUDE.md): at most 3 full harness runs per configuration. */
export const MAX_RUNS_PER_CONFIG = 3;

export function runsFor(config: string): string[] {
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir).filter((f) => f.startsWith(`${config}--`) && f.endsWith(".json")).sort();
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
