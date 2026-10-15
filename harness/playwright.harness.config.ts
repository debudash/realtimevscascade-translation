import { defineConfig, devices } from "@playwright/test";
import "../scripts/env.mjs";

// Evaluation harness (not part of `npm run e2e`): real providers, real cost. See harness/README.md.
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.harness\.ts$/,
  timeout: 20 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [["list"]],
  outputDir: "results/tmp/playwright",
  use: {
    baseURL: "http://localhost:5173",
    ...devices["Desktop Chrome"],
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
        "--enable-precise-memory-info",
      ],
    },
  },
  webServer: {
    command: "npm run dev",
    cwd: "..",
    url: "http://localhost:5173/api/health",
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
