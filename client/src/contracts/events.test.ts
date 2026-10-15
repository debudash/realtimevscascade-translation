import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVENT_TYPES, parseEvent } from "./events";

// The same file the C# EventContractTests round-trip.
const samples: unknown[] = JSON.parse(
  readFileSync(new URL("../../../contracts/event-samples.json", import.meta.url), "utf8"),
);

describe("event contract", () => {
  it.each(samples.map((s) => [(s as { type: string }).type, s]))("%s round-trips", (_type, sample) => {
    const parsed = parseEvent(JSON.stringify(sample));
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(sample);
  });

  it("has a sample for every TS event type, and no sample of an unknown type", () => {
    const sampleTypes = new Set(samples.map((s) => (s as { type: string }).type));
    expect([...sampleTypes].sort()).toEqual([...EVENT_TYPES].sort());
  });

  it("rejects unknown types and missing fields", () => {
    expect(() => parseEvent({ type: "nope", t: 1 })).toThrow(/Unknown event type/);
    expect(() => parseEvent({ type: "source.final", t: 1, lang: "en" })).toThrow(/text/);
  });
});
