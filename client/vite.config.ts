import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:5080",
      "/ws": { target: "ws://localhost:5080", ws: true },
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
