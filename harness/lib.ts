import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../scripts/env.mjs";

export const harnessDir = join(repoRoot, "harness");
export const resultsDir = join(harnessDir, "results");
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

/** The four evaluation configurations: URL only, no code changes (provider flexibility evidence). */
export const CONFIGS: Record<string, { url: string; label: string }> = {
  realtime: { url: "/?mode=realtime", label: "Realtime (gpt-realtime)" },
  "cascade-segment": { url: "/", label: "Cascade · segment (Deepgram · OpenAI · ElevenLabs)" },
  "cascade-clause": { url: "/?strategy=clause", label: "Cascade · clause (Deepgram · OpenAI · ElevenLabs)" },
  "cascade-deepl": { url: "/?providers=translation:deepl", label: "Cascade · segment, DeepL primary (Deepgram · DeepL · ElevenLabs)" },
};

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
