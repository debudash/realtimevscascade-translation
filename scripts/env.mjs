// Loads the repo-root .env for Node scripts (harness, report, Playwright setup).
// Real environment variables take precedence (override: false). Never logs values.
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

dotenv.config({ path: join(repoRoot, ".env"), override: false, quiet: true });

export const KEY_NAMES = ["OpenAI__ApiKey", "Deepgram__ApiKey", "ElevenLabs__ApiKey", "DeepL__ApiKey"];

/** True when the named key is present and non-blank. */
export function hasKey(name) {
  return Boolean(process.env[name]?.trim());
}

/** Message used by tests and scripts that skip because a key is missing. */
export function missingKeyMessage(name) {
  return `Skipped: ${name} is not set. Add it to .env in the project folder.`;
}
