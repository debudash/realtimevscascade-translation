import type { TransportFactory } from "../session/controller";
import { FakeTransport } from "./fake/FakeTransport";
import { CascadeTransport } from "./cascade/CascadeTransport";
import { RealtimeTransport } from "./realtime/RealtimeTransport";

/**
 * Picks the transport for a mode. `?transport=fake` forces the client-only simulator
 * (no backend audio path, no keys) for UI and audio-engine work.
 */
export function createTransportFactory(params: URLSearchParams): TransportFactory {
  const forceFake = params.get("transport") === "fake";
  // Fault injection for fake cascade providers, e.g. ?providers=fake&faults=translation:429,tts:timeout
  const faults = params.get("faults")
    ? Object.fromEntries(params.get("faults")!.split(",").map((kv) => kv.split(":") as [string, string]))
    : undefined;
  return ({ mode, sink, player, capture, pairId, strategy, providers, controls }) => {
    if (forceFake) return new FakeTransport(sink, player);
    const opts = { pairId, strategy, providers, captureTrack: capture.track, controls };
    if (mode === "realtime") return new RealtimeTransport(sink, opts);
    return new CascadeTransport(sink, player, opts, faults);
  };
}
