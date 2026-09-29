import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["packages/*/src/**/*.test.ts", "apps/worker/src/**/*.test.ts"],
          exclude: ["**/*.integration.test.ts", "**/node_modules/**"],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["packages/*/src/**/*.integration.test.ts", "apps/*/src/**/*.integration.test.ts"],
          exclude: ["**/node_modules/**"],
          globalSetup: ["packages/db/src/testing/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      "apps/web/vitest.config.ts",
    ],
  },
});
