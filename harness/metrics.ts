// Pure helpers for the evaluation report (unit-tested in metrics.test.ts).

// WER is shared with the UI (Experiments tab), so it lives with the client code.
import { normalize } from "../client/src/state/wer";
export { normalize, wer } from "../client/src/state/wer";

/** Linear-interpolated percentile (numpy default). */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return s[lo] + (s[hi] - s[lo]) * (rank - lo);
}

const STOPWORDS: Record<string, string[]> = {
  en: ["the", "is", "and", "you", "your", "my", "have", "to", "of", "it", "do", "does", "what", "he", "she", "i", "we", "will"],
  es: ["el", "la", "es", "y", "usted", "su", "mi", "tengo", "de", "un", "una", "que", "lo", "le", "les", "se", "no", "por", "para", "con", "los", "las", "cuando", "duele"],
  fr: ["le", "la", "est", "et", "vous", "votre", "mon", "de", "un", "une", "que", "il", "elle", "je", "nous", "pour", "avec", "les"],
};

/** Rough language guess from stopword hits; null when nothing matches or it is a tie. */
export function guessLanguage(text: string): string | null {
  const words = normalize(text);
  const scores = Object.entries(STOPWORDS)
    .map(([lang, stops]) => ({ lang, hits: words.filter((w) => stops.includes(w)).length }))
    .sort((a, b) => b.hits - a.hits);
  if (scores[0].hits === 0 || scores[0].hits === scores[1].hits) return null;
  return scores[0].lang;
}

export interface AnswerCheck {
  flagged: boolean;
  reasons: string[];
}

/**
 * Heuristic "answered instead of interpreted" check (feeds a manual review list):
 * - a question came out as a statement (no question mark);
 * - the output is much longer than the reference translation (added content);
 * - the output is not in the target language (e.g. a reply in the speaker's language).
 */
export function answeredHeuristic(opts: {
  target: string;
  reference: string;
  targetLang: string;
  question: boolean;
}): AnswerCheck {
  const reasons: string[] = [];
  const t = opts.target.trim();
  if (t.length === 0) return { flagged: false, reasons };
  if (opts.question && !t.includes("?")) reasons.push("question rendered as a statement");
  const ratio = normalize(t).length / Math.max(1, normalize(opts.reference).length);
  if (ratio > 1.8) reasons.push(`output ${ratio.toFixed(1)}x the reference length`);
  const lang = guessLanguage(t);
  if (lang && lang !== opts.targetLang) reasons.push(`output looks like ${lang}, expected ${opts.targetLang}`);
  return { flagged: reasons.length > 0, reasons };
}

// Cost per turn is shared with the UI (comparison blocks), so it lives with the client code.
export { turnCost, type Pricing, type UsageLike } from "../client/src/state/cost";
