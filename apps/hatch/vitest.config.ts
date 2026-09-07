import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    teardownTimeout: 10_000,
    pool: "threads",
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 2,
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.ts"],
      thresholds: {
        statements: 34,
        lines: 34,
        functions: 66,
        branches: 66,
      },
    },
  },
});
