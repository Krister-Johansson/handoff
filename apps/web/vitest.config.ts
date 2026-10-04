import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    name: "web",
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.integration.test.ts", "**/node_modules/**"],
    setupFiles: ["./vitest.setup.ts"],
    // Through Vite rather than Node, so theme-provider.test.tsx can hand it the React build Next.js runs.
    server: { deps: { inline: ["next-themes"] } },
  },
});
