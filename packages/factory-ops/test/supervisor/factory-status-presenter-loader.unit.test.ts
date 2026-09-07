import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  formatRuntimeDriftSection,
  resolveSafeProcessCwd,
  resolveSharedPresenterCandidates,
} from "../../src/lib/factory-status-presenter.ts";

test("resolveSafeProcessCwd returns empty string for uv_cwd failures", () => {
  const cwd = resolveSafeProcessCwd({
    cwdResolver: () => {
      const error = new Error("uv_cwd: current directory unavailable");
      error.code = "ENOENT";
      throw error;
    },
  });

  assert.equal(cwd, "");
});

test("resolveSharedPresenterCandidates skips cwd candidate when cwd lookup fails", () => {
  const failedCwdCandidate = path.resolve("/tmp/failing-cwd", "apps", "hatch", "dist", "factory", "status-presenter.js");
  const candidates = resolveSharedPresenterCandidates({
    moduleUrl: import.meta.url,
    cwdResolver: () => {
      throw new Error("uv_cwd: current directory unavailable");
    },
    contextRepoRoot: "/tmp/context-repo",
  });

  assert.equal(
    candidates.some((candidate) => candidate === path.resolve("/tmp/context-repo", "apps", "hatch", "dist", "factory", "status-presenter.js")),
    true,
  );
  assert.equal(
    candidates.some((candidate) => candidate === path.resolve("/tmp/context-repo", "apps", "hatch", "src", "factory", "status-presenter.ts")),
    true,
  );
  assert.equal(candidates.includes(failedCwdCandidate), false);
});

test("shared presenter loader re-exports runtime drift formatter", () => {
  const lines = formatRuntimeDriftSection({
    runtime_version: "0.9.0",
    kind_version: "mothership",
    rollout_channel: "stable",
    rollout_status: "ready",
    upgrade_verification_outcome: "passed",
    drift_state: "ready",
  });

  assert.match(lines.join("\n"), /Runtime drift:/);
  assert.match(lines.join("\n"), /Runtime version: 0\.9\.0/);
});
