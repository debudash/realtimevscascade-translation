// Generates the synthetic evaluation clips ONCE with ElevenLabs and caches them in harness/clips/.
// Existing clips are never regenerated (cost guardrail). Usage: npx tsx harness/generate-clips.ts [lang...]
// Output: 16 kHz mono PCM16 WAV, trimmed to 250 ms of lead-in and 150 ms of tail silence, so a replay
// turn's release (250 ms after the clip ends) lands ~400 ms after speech end, like a prompt human release.
// Docs: https://elevenlabs.io/docs/api-reference/text-to-speech/convert (output_format=pcm_16000)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hasKey, missingKeyMessage, repoRoot } from "../scripts/env.mjs";

interface Clip {
  id: string;
  lang: string;
  text: string;
}
interface Scripts {
  voices: Record<string, { voiceId: string }>;
  clips: Clip[];
}

const RATE = 16000;
const LEAD_MS = 250;
const TAIL_MS = 150;
const MODEL = "eleven_multilingual_v2"; // the speaker's voice (natural prosody); the cascade output uses Flash

export function trimSilence(pcm: Int16Array, rate = RATE, thresholdDbfs = -45): Int16Array {
  const frame = rate / 50;
  const voiced: number[] = [];
  for (let i = 0; i + frame <= pcm.length; i += frame) {
    let sum = 0;
    for (let j = i; j < i + frame; j++) sum += (pcm[j] / 32768) ** 2;
    if (20 * Math.log10(Math.sqrt(sum / frame) || 1e-9) >= thresholdDbfs) voiced.push(i);
  }
  if (voiced.length === 0) return pcm;
  const start = voiced[0];
  const end = voiced[voiced.length - 1] + frame;
  const lead = new Int16Array((LEAD_MS * rate) / 1000);
  const tail = new Int16Array((TAIL_MS * rate) / 1000);
  const out = new Int16Array(lead.length + (end - start) + tail.length);
  out.set(pcm.subarray(start, end), lead.length);
  return out;
}

export function wav(pcm: Int16Array, rate = RATE): Buffer {
  const header = Buffer.alloc(44);
  const dataBytes = pcm.length * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, Buffer.from(pcm.buffer, pcm.byteOffset, dataBytes)]);
}

async function synthesize(text: string, voiceId: string): Promise<Int16Array> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=pcm_16000`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ElevenLabs__ApiKey!, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: MODEL }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
}

async function main() {
  if (!hasKey("ElevenLabs__ApiKey")) {
    console.log(missingKeyMessage("ElevenLabs__ApiKey"));
    return;
  }
  const langs = process.argv.slice(2);
  const scripts: Scripts = JSON.parse(readFileSync(join(repoRoot, "harness", "scripts.json"), "utf8"));
  const dir = join(repoRoot, "harness", "clips");
  mkdirSync(dir, { recursive: true });
  let made = 0;
  let chars = 0;
  for (const clip of scripts.clips) {
    if (langs.length && !langs.includes(clip.lang)) continue;
    const path = join(dir, `${clip.id}.wav`);
    if (existsSync(path)) continue; // generate once
    const pcm = trimSilence(await synthesize(clip.text, scripts.voices[clip.lang].voiceId));
    writeFileSync(path, wav(pcm));
    made++;
    chars += clip.text.length;
    console.log(`${clip.id}: ${(pcm.length / RATE).toFixed(2)} s`);
  }
  console.log(`Generated ${made} clip(s), ${chars} characters. Existing clips were kept.`);
}

await main();
