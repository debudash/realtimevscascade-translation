import type { ProviderSet } from "./contracts/events";

export interface Health {
  status: string;
  configOk: boolean;
  /** Names of missing variables (never values). */
  missing: string[];
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
}

export interface ClipInfo {
  id: string;
  lang: string;
  text: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  health: () => getJson<Health>("/api/health"),
  config: () => getJson<AppConfig>("/api/config"),
  clips: () => getJson<ClipInfo[]>("/api/clips"),
};
