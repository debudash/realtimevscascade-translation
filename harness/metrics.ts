// Pure helpers for the evaluation report (unit-tested in metrics.test.ts).

const NUMBERS: Record<string, string[]> = {
  en: ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"],
  es: ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce"],
  fr: ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze"],
};

/** Lowercase, strip punctuation (incl. ¿ ¡), spell out 0-12, collapse whitespace. */
export function normalize(text: string, lang = "en"): string[] {
  const words = text
    .toLowerCase()
    .replace(/[.,;:!?¿¡"“”()\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const nums = NUMBERS[lang] ?? NUMBERS.en;
  return words.map((w) => (/^\d+$/.test(w) && Number(w) < nums.length ? nums[Number(w)] : w));
}

/** Word error rate: word-level Levenshtein distance / reference length. */
export function wer(reference: string, hypothesis: string, lang = "en"): number {
  const r = normalize(reference, lang);
  const h = normalize(hypothesis, lang);
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[h.length] / r.length;
}

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

export interface Pricing {
  verifiedOn: string;
  realtime: { audioInPer1M: number; cachedInPer1M: number; textInPer1M: number; audioOutPer1M: number; textOutPer1M: number };
  realtimeTranscriptionPerMinute: number;
  deepgramPerMinute: number;
  openaiTranslation: { inPer1M: number; outPer1M: number };
  deeplPer1MChars: number;
  elevenLabsPer1kChars: number;
}

export interface UsageLike {
  sttAudioSeconds: number;
  translationInputTokens: number;
  translationOutputTokens: number;
  translationCharacters: number;
  ttsCharacters: number;
  realtime?: { inputAudioTokens: number; inputTextTokens: number; cachedInputTokens: number; outputAudioTokens: number; outputTextTokens: number };
}

/** USD for one turn from its logged usage. `translation` is the provider that served it. */
export function turnCost(u: UsageLike, p: Pricing, translation: string): number {
  if (u.realtime) {
    const r = u.realtime;
    const uncachedText = Math.max(0, r.inputTextTokens - r.cachedInputTokens);
    const model =
      (r.inputAudioTokens * p.realtime.audioInPer1M +
        uncachedText * p.realtime.textInPer1M +
        r.cachedInputTokens * p.realtime.cachedInPer1M +
        r.outputAudioTokens * p.realtime.audioOutPer1M +
        r.outputTextTokens * p.realtime.textOutPer1M) /
      1e6;
    return model + (u.sttAudioSeconds / 60) * p.realtimeTranscriptionPerMinute;
  }
  const stt = (u.sttAudioSeconds / 60) * p.deepgramPerMinute;
  const tr =
    translation === "deepl"
      ? (u.translationCharacters * p.deeplPer1MChars) / 1e6
      : (u.translationInputTokens * p.openaiTranslation.inPer1M + u.translationOutputTokens * p.openaiTranslation.outPer1M) / 1e6;
  const tts = (u.ttsCharacters / 1000) * p.elevenLabsPer1kChars;
  return stt + tr + tts;
}
