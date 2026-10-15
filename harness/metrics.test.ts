import { describe, expect, it } from "vitest";
import { answeredHeuristic, guessLanguage, normalize, percentile, turnCost, wer, type Pricing } from "./metrics";

describe("normalize / wer", () => {
  it("ignores case, punctuation and inverted marks, and spells out small numbers", () => {
    expect(normalize("¿Cuántas veces al día?", "es")).toEqual(["cuántas", "veces", "al", "día"]);
    expect(normalize("at 3 with the doctor", "en")).toEqual(["at", "three", "with", "the", "doctor"]);
  });

  it("is 0 for an exact match modulo formatting", () => {
    expect(wer("Tengo una cita a las tres con la doctora.", "tengo una cita a las 3 con la doctora", "es")).toBe(0);
  });

  it("counts substitutions, insertions and deletions over the reference length", () => {
    expect(wer("my son has a fever", "my son had a fever")).toBeCloseTo(1 / 5);
    expect(wer("my son has a fever", "my son has a high fever")).toBeCloseTo(1 / 5);
    expect(wer("my son has a fever", "my son a fever")).toBeCloseTo(1 / 5);
    expect(wer("a b", "")).toBe(1);
    expect(wer("", "")).toBe(0);
  });
});

describe("percentile", () => {
  it("matches numpy linear interpolation", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBeCloseTo(9.55);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("answered instead of interpreted", () => {
  it("passes a faithful question", () => {
    expect(answeredHeuristic({ target: "¿Es alérgico a algún medicamento?", reference: "¿Es alérgico a algún medicamento?", targetLang: "es", question: true }).flagged).toBe(false);
  });

  it("flags a question answered as a statement", () => {
    const r = answeredHeuristic({ target: "No, he is not allergic to any medication.", reference: "Is he allergic to any medication?", targetLang: "es", question: true });
    expect(r.flagged).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/statement/);
    expect(r.reasons.join(" ")).toMatch(/looks like en/);
  });

  it("flags added content", () => {
    const r = answeredHeuristic({
      target: "Mi hijo tiene fiebre desde anoche. Le recomiendo que lo lleve al médico lo antes posible para una revisión completa.",
      reference: "Mi hijo tiene fiebre desde anoche.",
      targetLang: "es",
      question: false,
    });
    expect(r.flagged).toBe(true);
  });

  it("guesses language from stopwords", () => {
    expect(guessLanguage("Tengo una cita con la doctora")).toBe("es");
    expect(guessLanguage("I have an appointment with the doctor")).toBe("en");
    // "le" is both Spanish and French; Spanish-only words must decide.
    expect(guessLanguage("¿Le duele cuando respira hondo?")).toBe("es");
  });
});

describe("turnCost", () => {
  const p: Pricing = {
    verifiedOn: "2026-10-15",
    realtime: { audioInPer1M: 32, cachedInPer1M: 0.4, textInPer1M: 4, audioOutPer1M: 64, textOutPer1M: 16 },
    realtimeTranscriptionPerMinute: 0.006,
    deepgramPerMinute: 0.0048,
    openaiTranslation: { inPer1M: 0.1, outPer1M: 0.4 },
    deeplPer1MChars: 25,
    elevenLabsPer1kChars: 0.04,
  };

  it("prices a cascade turn from STT minutes, tokens and TTS characters", () => {
    const c = turnCost({ sttAudioSeconds: 60, translationInputTokens: 1e6, translationOutputTokens: 0, translationCharacters: 0, ttsCharacters: 1000 }, p, "openai");
    expect(c).toBeCloseTo(0.0048 + 0.1 + 0.04);
  });

  it("prices DeepL by characters", () => {
    const c = turnCost({ sttAudioSeconds: 0, translationInputTokens: 0, translationOutputTokens: 0, translationCharacters: 1e6, ttsCharacters: 0 }, p, "deepl");
    expect(c).toBeCloseTo(25);
  });

  it("prices a realtime turn from tokens plus side transcription", () => {
    const c = turnCost(
      {
        sttAudioSeconds: 60, translationInputTokens: 0, translationOutputTokens: 0, translationCharacters: 0, ttsCharacters: 0,
        realtime: { inputAudioTokens: 600, inputTextTokens: 200, cachedInputTokens: 100, outputAudioTokens: 1200, outputTextTokens: 50 },
      },
      p,
      "gpt-realtime",
    );
    expect(c).toBeCloseTo((600 * 32 + 100 * 4 + 100 * 0.4 + 1200 * 64 + 50 * 16) / 1e6 + 0.006);
  });
});
