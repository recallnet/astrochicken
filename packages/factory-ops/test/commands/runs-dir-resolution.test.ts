import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  resolveCacheDir,
  resolveFactoryRuntimePaths,
  resolveLogsDir,
  resolveRunsDir,
  resolveTmpDir,
} from "../../src/lib/runs-dir-resolver.ts";

test("resolveRunsDir prefers explicit runs dir", () => {
  assert.equal(resolveRunsDir({ runsDir: "/tmp/runs", factoryId: "mothership" }), "/tmp/runs");
});

test("resolveRunsDir scopes default dir by factory id", () => {
  assert.equal(
    resolveRunsDir({ factoryId: "mothership" }),
    path.resolve(".hatch", "mothership", "runs"),
  );
});

test("resolveRunsDir falls back to legacy root when factory id is missing", () => {
  assert.equal(resolveRunsDir({}), path.resolve(".hatch", "runs"));
});

test("resolveRunsDir honors isolation path overrides", () => {
  assert.equal(
    resolveRunsDir({
      factoryId: "mothership",
      isolationPaths: { runs: ".factory-runtime/runs" },
      baseDir: "/tmp/workspace",
    }),
    "/tmp/workspace/.factory-runtime/runs",
  );
});

test("resolve logs/tmp/cache directories from isolation overrides", () => {
  const runsDir = "/tmp/workspace/.hatch/mothership/runs";
  const isolationPaths = {
    logs: "/tmp/workspace/custom-logs",
    tmp: "/tmp/workspace/custom-tmp",
    cache: "/tmp/workspace/custom-cache",
  };

  assert.equal(resolveLogsDir({ runsDir, isolationPaths }), "/tmp/workspace/custom-logs");
  assert.equal(resolveTmpDir({ runsDir, isolationPaths }), "/tmp/workspace/custom-tmp");
  assert.equal(resolveCacheDir({ runsDir, isolationPaths }), "/tmp/workspace/custom-cache");
});

test("two factories with different isolation paths resolve distinct runtime roots", () => {
  const alpha = resolveFactoryRuntimePaths({
    factoryId: "alpha",
    isolationPaths: {
      runs: "/tmp/runtime/alpha/runs",
      logs: "/tmp/runtime/alpha/logs",
      tmp: "/tmp/runtime/alpha/tmp",
      cache: "/tmp/runtime/alpha/cache",
    },
  });

  const beta = resolveFactoryRuntimePaths({
    factoryId: "beta",
    isolationPaths: {
      runs: "/tmp/runtime/beta/runs",
      logs: "/tmp/runtime/beta/logs",
      tmp: "/tmp/runtime/beta/tmp",
      cache: "/tmp/runtime/beta/cache",
    },
  });

  assert.notEqual(alpha.runsDir, beta.runsDir);
  assert.notEqual(alpha.logsDir, beta.logsDir);
  assert.notEqual(alpha.tmpDir, beta.tmpDir);
  assert.notEqual(alpha.cacheDir, beta.cacheDir);
});
