// Word error rate for source and target text. Shared by the evaluation report
// (harness/metrics.ts re-exports it) and the Experiments tab.

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
