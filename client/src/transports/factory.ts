import type { TransportFactory } from "../session/controller";
import { FakeTransport } from "./fake/FakeTransport";

/**
 * Picks the transport for a mode. `?transport=fake` forces the client-only simulator
 * (no backend audio path, no keys) for UI and audio-engine work.
 */
export function createTransportFactory(params: URLSearchParams): TransportFactory {
  const forceFake = params.get("transport") === "fake";
  return ({ sink, player }) => {
    if (forceFake) return new FakeTransport(sink, player);
    return new FakeTransport(sink, player);
  };
}
