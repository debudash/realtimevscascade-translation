/**
 * Maps an AudioContext time (seconds) onto the browser clock (performance.now() ms), so audio
 * marks (T0, first audible) share a timeline with UI and network marks.
 */
export function ctxTimeToPerf(ctx: AudioContext, ctxTime: number): number {
  const ts = ctx.getOutputTimestamp();
  if (ts.contextTime === undefined || ts.performanceTime === undefined || ts.performanceTime === 0) {
    // Context not running yet: fall back to "now" at the current context time.
    return performance.now() + (ctxTime - ctx.currentTime) * 1000;
  }
  return ts.performanceTime + (ctxTime - ts.contextTime) * 1000;
}
