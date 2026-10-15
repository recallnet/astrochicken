import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    teardownTimeout: 10_000,
    pool: "threads",
    minWorkers: 1,
    maxWorkers: 2,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.ts"],
    },
  },
});
