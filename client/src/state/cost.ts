// USD for one turn from its logged usage and a pricing table (harness/pricing.json).
// Shared by the evaluation report (harness/metrics.ts re-exports it) and the UI's comparison blocks.

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
