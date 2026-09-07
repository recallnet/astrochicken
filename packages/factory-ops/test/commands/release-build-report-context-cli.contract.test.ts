import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

test("cli wiring includes release build-report-context command", () => {
  const source = readFileSync("packages/factory-ops/src/cli/commands/release-context-cmds.ts", "utf8");
  assert.match(source, /class ReleaseBuildReportContextCommand/);
  assert.match(source, /static paths = \[\["release", "build-report-context"\]\]/);
  assert.match(source, /Option\.String\("--repo", ""\)/);
  assert.match(source, /Option\.String\("--repo-path", "\."\)/);
  assert.match(source, /Option\.String\("--factory-id", ""\)/);
  assert.match(source, /Option\.String\("--lookback-hours", "24"\)/);
  assert.match(source, /Option\.String\("--now", ""\)/);
});

test("release_report_flow passes the factory repo_path into build-report-context", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/capability-release-reporting/release_report_flow.dot", "utf8");
  assert.match(dot, /build_release_report_context \[type="tool" governance="reversible" action_runtime="in_process" action_id="release\.build_report_context"/);
  assert.match(dot, /action_repo="\$\{gh_repo\}" action_repo_path="\$\{repo_path\}" action_factory_id="\$\{factory_id\}"/);
});

test("release build-report-context returns JSON contract with deterministic defaults", () => {
  const tempRepoPath = mkdtempSync(join(tmpdir(), "release-context-cli-"));

  const run = spawnSync("node", [
    opsCliPath,
    "release",
    "build-report-context",
    "--repo",
    "acme/platform",
    "--repo-path",
    tempRepoPath,
    "--factory-id",
    "mothership",
    "--now",
    "2026-03-09T20:00:00.000Z",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout || "{}");
  assert.equal(payload.repo, "acme/platform");
  assert.equal(payload.factory_id, "mothership");
  assert.equal(payload.generated_at, "2026-03-09T20:00:00.000Z");
  assert.equal(payload.since_iso, "2026-03-08T20:00:00.000Z");
  assert.ok(Array.isArray(payload.goals));
  assert.ok(Array.isArray(payload.issues));
  assert.ok(Array.isArray(payload.prs));
  assert.ok(payload.metrics && typeof payload.metrics === "object");
  assert.ok(payload.diff_stats && typeof payload.diff_stats === "object");
  assert.ok(payload.timing && typeof payload.timing === "object");
  assert.ok(Array.isArray(payload.errors));
});

test("release build-report-context exits 1 when --repo is missing", () => {
  const run = spawnSync("node", [
    opsCliPath,
    "release",
    "build-report-context",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /--repo is required/);
});
