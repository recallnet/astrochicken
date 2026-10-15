import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    teardownTimeout: 10_000,
    // @context:regression CLI portability tests change cwd; fork isolation supports
    // that Node API while worker threads explicitly reject process.chdir().
    pool: "forks",
    minWorkers: 1,
    maxWorkers: 2,
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
