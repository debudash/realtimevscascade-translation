import type { TransportFactory } from "../session/controller";
import { FakeTransport } from "./fake/FakeTransport";
import { RealtimeTransport } from "./realtime/RealtimeTransport";

/**
 * Picks the transport for a mode. `?transport=fake` forces the client-only simulator
 * (no backend audio path, no keys) for UI and audio-engine work.
 */
export function createTransportFactory(params: URLSearchParams): TransportFactory {
  const forceFake = params.get("transport") === "fake";
  return ({ mode, sink, player, capture, pairId, strategy, providers }) => {
    if (forceFake) return new FakeTransport(sink, player);
    const opts = { pairId, strategy, providers, captureTrack: capture.track };
    if (mode === "realtime") return new RealtimeTransport(sink, opts);
    return new FakeTransport(sink, player); // replaced by CascadeTransport in M3
  };
}
