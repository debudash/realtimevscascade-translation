import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Only the client is served; edits elsewhere in the repo (docs, harness results) must never reload the page.
    watch: { ignored: ["**/server/**", "**/docs/**", "**/harness/**", "**/e2e/**", "**/*.md"] },
    proxy: {
      "/api": "http://localhost:5080",
      "/ws": { target: "ws://localhost:5080", ws: true },
    },
  },
  test: {
    include: ["src/**/*.test.ts", "../harness/**/*.test.ts"],
    environment: "node",
  },
});
