/**
 * Maps a playback AudioContext time (seconds) onto the browser clock (performance.now() ms):
 * when that sample reaches the speaker, per getOutputTimestamp(). Used for first_audible.
 * Capture timestamps use their own mapping (captureEngine.ts).
 */
export function ctxTimeToPerf(ctx: AudioContext, ctxTime: number): number {
  const ts = ctx.getOutputTimestamp();
  if (ts.contextTime === undefined || ts.performanceTime === undefined || ts.performanceTime === 0) {
    // Context not running yet: fall back to "now" at the current context time.
    return performance.now() + (ctxTime - ctx.currentTime) * 1000;
  }
  return ts.performanceTime + (ctxTime - ts.contextTime) * 1000;
}
