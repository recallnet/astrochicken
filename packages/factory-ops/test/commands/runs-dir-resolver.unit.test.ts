import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  resolveRunsDir,
  resolveLogsDir,
  resolveTmpDir,
  resolveCacheDir,
  resolveFactoryRuntimePaths,
} from "../../src/lib/runs-dir-resolver.ts";

const BASE = "/test/base";

describe("resolveRunsDir", () => {
  it("explicit absolute path is used directly", () => {
    const result = resolveRunsDir({ runsDir: "/abs/runs", baseDir: BASE });
    assert.equal(result, "/abs/runs");
  });

  it("explicit relative path is resolved from baseDir", () => {
    const result = resolveRunsDir({ runsDir: "rel/runs", baseDir: BASE });
    assert.equal(result, path.resolve(BASE, "rel/runs"));
  });

  it("uses isolationPaths.runs when runsDir is empty", () => {
    const result = resolveRunsDir({
      isolationPaths: { runs: "/isolation/runs" },
      baseDir: BASE,
    });
    assert.equal(result, "/isolation/runs");
  });

  it("isolationPaths.runs relative is resolved from baseDir", () => {
    const result = resolveRunsDir({
      isolationPaths: { runs: "iso/runs" },
      baseDir: BASE,
    });
    assert.equal(result, path.resolve(BASE, "iso/runs"));
  });

  it("default with factoryId includes factoryId in path", () => {
    const result = resolveRunsDir({ factoryId: "my-factory", baseDir: BASE });
    assert.equal(result, path.resolve(".hatch", "my-factory", "runs"));
  });

  it("default without factoryId returns .hatch/runs", () => {
    const result = resolveRunsDir({ baseDir: BASE });
    assert.equal(result, path.resolve(".hatch", "runs"));
  });
});

describe("resolveLogsDir", () => {
  it("explicit logsDir is used directly", () => {
    const result = resolveLogsDir({ logsDir: "/explicit/logs", baseDir: BASE });
    assert.equal(result, "/explicit/logs");
  });

  it("uses isolationPaths.logs when logsDir is empty", () => {
    const result = resolveLogsDir({
      isolationPaths: { logs: "/isolation/logs" },
      baseDir: BASE,
    });
    assert.equal(result, "/isolation/logs");
  });

  it("default falls back to <runsDir>/logs", () => {
    const result = resolveLogsDir({ runsDir: "/my/runs", baseDir: BASE });
    assert.equal(result, path.resolve("/my/runs", "logs"));
  });
});

describe("resolveTmpDir", () => {
  it("explicit tmpDir is used directly", () => {
    const result = resolveTmpDir({ tmpDir: "/explicit/tmp", baseDir: BASE });
    assert.equal(result, "/explicit/tmp");
  });

  it("uses isolationPaths.tmp when tmpDir is empty", () => {
    const result = resolveTmpDir({
      isolationPaths: { tmp: "/isolation/tmp" },
      baseDir: BASE,
    });
    assert.equal(result, "/isolation/tmp");
  });

  it("default falls back to <runsDir>/tmp", () => {
    const result = resolveTmpDir({ runsDir: "/my/runs", baseDir: BASE });
    assert.equal(result, path.resolve("/my/runs", "tmp"));
  });
});

describe("resolveCacheDir", () => {
  it("explicit cacheDir is used directly", () => {
    const result = resolveCacheDir({ cacheDir: "/explicit/cache", baseDir: BASE });
    assert.equal(result, "/explicit/cache");
  });

  it("uses isolationPaths.cache when cacheDir is empty", () => {
    const result = resolveCacheDir({
      isolationPaths: { cache: "/isolation/cache" },
      baseDir: BASE,
    });
    assert.equal(result, "/isolation/cache");
  });

  it("default falls back to <runsDir>/cache", () => {
    const result = resolveCacheDir({ runsDir: "/my/runs", baseDir: BASE });
    assert.equal(result, path.resolve("/my/runs", "cache"));
  });
});

describe("resolveFactoryRuntimePaths", () => {
  it("all defaults without factoryId", () => {
    const result = resolveFactoryRuntimePaths({ baseDir: BASE });
    const expectedRuns = path.resolve(".hatch", "runs");
    assert.deepEqual(result, {
      runsDir: expectedRuns,
      logsDir: path.resolve(expectedRuns, "logs"),
      tmpDir: path.resolve(expectedRuns, "tmp"),
      cacheDir: path.resolve(expectedRuns, "cache"),
    });
  });

  it("with factoryId scoping", () => {
    const result = resolveFactoryRuntimePaths({ factoryId: "acme", baseDir: BASE });
    const expectedRuns = path.resolve(".hatch", "acme", "runs");
    assert.deepEqual(result, {
      runsDir: expectedRuns,
      logsDir: path.resolve(expectedRuns, "logs"),
      tmpDir: path.resolve(expectedRuns, "tmp"),
      cacheDir: path.resolve(expectedRuns, "cache"),
    });
  });

  it("explicit overrides take precedence", () => {
    const result = resolveFactoryRuntimePaths({
      runsDir: "/r",
      logsDir: "/l",
      tmpDir: "/t",
      cacheDir: "/c",
      baseDir: BASE,
    });
    assert.deepEqual(result, {
      runsDir: "/r",
      logsDir: "/l",
      tmpDir: "/t",
      cacheDir: "/c",
    });
  });
});
