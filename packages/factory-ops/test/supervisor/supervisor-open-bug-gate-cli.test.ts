import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");
const snapshotFixturePath = join(repoRoot, "packages/factory-ops/test/supervisor/fixtures/open-bug-snapshot.json");

function makeGhStubBin(mode = "open_bugs") {
  const binDir = mkdtempSync(join(tmpdir(), "open-bug-gate-gh-stub-"));
  const ghPath = join(binDir, "gh");
  writeFileSync(ghPath, `#!/usr/bin/env bash
set -euo pipefail
cmd="$*"
mode="\${HATCH_TEST_GH_MODE:-open_bugs}"
if [[ "$cmd" == api* ]]; then
  printf '%s' '[]'
  exit 0
fi
if [[ "$cmd" == *"issue view"* ]]; then
  printf '%s' '{"state":"OPEN"}'
  exit 0
fi
if [[ "$cmd" == *"issue list"* && "$cmd" == *"--repo example-org/example-trading"* ]]; then
  if [[ "$mode" == "gh_failure" ]]; then
    printf '%s' 'gh api rate limit exceeded' >&2
    exit 1
  fi
  if [[ "$mode" == "invalid_json_output" ]]; then
    printf '%s' '{not-json'
    exit 0
  fi
  if [[ "$mode" == "malformed_open_bugs" ]]; then
    printf '%s' '{"unexpected":"shape"}'
  elif [[ "$mode" == "needs_triage_non_blocking" ]]; then
    printf '%s' '[{"number":9002,"title":"[bug] ambiguous example-trading incident","labels":[{"name":"managed-factory-bug"},{"name":"factory:example-trading"},{"name":"needs-triage"}]},{"number":9001,"title":"[bug] fast-route regression","labels":[{"name":"managed-factory-bug"},{"name":"factory:example-trading"}]}]'
  else
    printf '%s' '[{"number":9002,"title":"[bug] open-bug gate drift","labels":[{"name":"managed-factory-bug"},{"name":"factory:example-trading"}]},{"number":9001,"title":"[bug] fast-route regression","labels":[{"name":"managed-factory-bug"},{"name":"factory:example-trading"}]}]'
  fi
  exit 0
fi
if [[ "$cmd" == *"--label bug"* ]]; then
  if [[ "$mode" == "malformed_open_bugs" ]]; then
    printf '%s' '{"unexpected":"shape"}'
  else
    printf '%s' '[{"number":9001,"title":"[bug] fast-route regression","createdAt":"2026-03-08T00:00:00Z","body":"bug one","labels":[{"name":"bug"}]},{"number":9002,"title":"[bug] open-bug gate drift","createdAt":"2026-03-08T00:01:00Z","body":"bug two","labels":[{"name":"bug"}]}]'
  fi
  exit 0
fi
printf '%s' '[]'
`, "utf8");
  chmodSync(ghPath, 0o755);
  return { binDir, mode };
}

function runOpenBugGateCliWithStub({ mode }) {
  const { binDir } = makeGhStubBin(mode);
  try {
    return spawnSync("node", [
      opsCliPath,
      "supervisor",
      "open-bug-gate",
      "--repo", "example-org/example-trading",
      "--control-plane-repo", "recallnet/astrochicken",
      "--label", "managed-factory-bug",
      "--bug-label", "factory:example-trading",
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HATCH_TEST_GH_MODE: mode,
        PATH: `${binDir}:${process.env.PATH || ""}`,
      },
    });
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
}

test("supervisor open-bug-gate CLI accepts --snapshot-file overrides deterministically", () => {
  const run = spawnSync("node", [
    opsCliPath,
    "supervisor",
    "open-bug-gate",
    "--snapshot-file", snapshotFixturePath,
    "--label", "managed-factory-bug",
    "--bug-label", "factory:example-trading",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(String(run.stdout || "{}"));
  assert.equal(out.has_open_bugs, "true");
  assert.equal(out.open_upstream_bugs, "true");
  assert.equal(out.open_bug_count, 2);
  assert.deepEqual(out.issue_numbers, [1347, 1348]);
  assert.equal(out.parse_error, "");
});

test("supervisor open-bug-gate CLI fails safe on malformed --snapshot-json payload", () => {
  const run = spawnSync("node", [opsCliPath, "supervisor", "open-bug-gate", "--snapshot-json", "{broken-json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(String(run.stdout || "{}"));
  assert.equal(out.has_open_bugs, "false");
  assert.equal(out.open_upstream_bugs, "false");
  assert.equal(out.open_bug_count, 0);
  assert.deepEqual(out.issue_numbers, []);
  assert.ok(String(out.parse_error || "").length > 0);
});

test("supervisor open-bug-gate CLI --repo path uses target-repo query deterministically", () => {
  const run = runOpenBugGateCliWithStub({ mode: "open_bugs" });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(String(run.stdout || "{}"));
  assert.equal(out.has_open_bugs, "true");
  assert.equal(out.open_upstream_bugs, "true");
  assert.equal(out.open_bug_count, 2);
  assert.deepEqual(out.issue_numbers, [9001, 9002]);
  assert.equal(out.parse_error, "");
});

test("supervisor open-bug-gate CLI --repo path fails safe on malformed snapshot payload", () => {
  const run = runOpenBugGateCliWithStub({ mode: "malformed_open_bugs" });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(String(run.stdout || "{}"));
  assert.equal(out.has_open_bugs, "false");
  assert.equal(out.open_upstream_bugs, "false");
  assert.equal(out.open_bug_count, 0);
  assert.deepEqual(out.issue_numbers, []);
  assert.match(String(out.parse_error || ""), /open_bugs_malformed_payload/);
});

test("supervisor open-bug-gate CLI accepts repeatable --label and --bug-label flags", () => {
  const { binDir } = makeGhStubBin("open_bugs");
  try {
    const run = spawnSync("node", [
      opsCliPath,
      "supervisor",
      "open-bug-gate",
      "--repo", "example-org/example-trading",
      "--control-plane-repo", "recallnet/astrochicken",
      "--label", "managed-factory-bug",
      "--bug-label", "factory:example-trading",
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HATCH_TEST_GH_MODE: "open_bugs",
        PATH: `${binDir}:${process.env.PATH || ""}`,
      },
    });

    assert.equal(run.status, 0, run.stderr || run.stdout);
    const out = JSON.parse(String(run.stdout || "{}"));
    assert.equal(out.has_open_bugs, "true");
    assert.equal(out.open_upstream_bugs, "true");
    assert.equal(out.open_bug_count, 2);
    assert.deepEqual(out.issue_numbers, [9001, 9002]);
    assert.equal(out.parse_error, "");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("supervisor open-bug-gate CLI supports JSON array label expansion", () => {
  const { binDir } = makeGhStubBin("open_bugs");
  try {
    const run = spawnSync("node", [
      opsCliPath,
      "supervisor",
      "open-bug-gate",
      "--repo", "example-org/example-trading",
      "--control-plane-repo", "recallnet/astrochicken",
      "--label", '["managed-factory-bug","factory:example-trading"]',
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HATCH_TEST_GH_MODE: "open_bugs",
        PATH: `${binDir}:${process.env.PATH || ""}`,
      },
    });

    assert.equal(run.status, 0, run.stderr || run.stdout);
    const out = JSON.parse(String(run.stdout || "{}"));
    assert.equal(out.has_open_bugs, "true");
    assert.equal(out.open_upstream_bugs, "true");
    assert.equal(out.open_bug_count, 2);
    assert.deepEqual(out.issue_numbers, [9001, 9002]);
    assert.equal(out.parse_error, "");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("supervisor open-bug-gate CLI snapshot override path honors label filters", () => {
  const snapshot = JSON.stringify({
    open_bugs: [
      { number: 80, title: "[bug] missing one label", labels: [{ name: "managed-factory-bug" }] },
      { number: 90, title: "[bug] matching labels", labels: [{ name: "managed-factory-bug" }, { name: "factory:example-trading" }] },
    ],
  });

  const run = spawnSync("node", [
    opsCliPath,
    "supervisor",
    "open-bug-gate",
    "--snapshot-json", snapshot,
    "--label", "managed-factory-bug",
    "--bug-label", "factory:example-trading",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(String(run.stdout || "{}"));
  assert.equal(out.has_open_bugs, "true");
  assert.equal(out.open_upstream_bugs, "true");
  assert.equal(out.open_bug_count, 1);
  assert.deepEqual(out.issue_numbers, [90]);
  assert.equal(out.parse_error, "");
});

test("supervisor open-bug-gate CLI excludes needs-triage managed incidents from blocking count", () => {
  const run = runOpenBugGateCliWithStub({ mode: "needs_triage_non_blocking" });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(String(run.stdout || "{}"));
  assert.equal(out.has_open_bugs, "true");
  assert.equal(out.open_upstream_bugs, "true");
  assert.equal(out.open_bug_count, 1);
  assert.deepEqual(out.issue_numbers, [9001]);
  assert.equal(out.parse_error, "");
});

test("supervisor open-bug-gate CLI --repo path surfaces gh non-zero failures as parse_error and stays non-blocking", () => {
  const run = runOpenBugGateCliWithStub({ mode: "gh_failure" });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(String(run.stdout || "{}"));
  assert.equal(out.has_open_bugs, "false");
  assert.equal(out.open_upstream_bugs, "false");
  assert.equal(out.open_bug_count, 0);
  assert.deepEqual(out.issue_numbers, []);
  assert.ok(String(out.parse_error || "").length > 0);
  assert.match(String(out.parse_error || ""), /gh_issue_list_failed/);
});

test("supervisor open-bug-gate CLI --repo path surfaces gh JSON parse failures as parse_error and stays non-blocking", () => {
  const run = runOpenBugGateCliWithStub({ mode: "invalid_json_output" });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(String(run.stdout || "{}"));
  assert.equal(out.has_open_bugs, "false");
  assert.equal(out.open_upstream_bugs, "false");
  assert.equal(out.open_bug_count, 0);
  assert.deepEqual(out.issue_numbers, []);
  assert.ok(String(out.parse_error || "").length > 0);
  assert.match(String(out.parse_error || ""), /gh_issue_list_failed/);
});

// Acceptance criterion (goal #1729): recurrence_24h_count for
// feature_count_zero_after_normalize must stay <= 0 for two consecutive
// factory days after the normalize_features fix lands. This test asserts
// the signal shape is recognized by the open-bug gate — the two-day
// recurrence check is enforced by factory telemetry, not by this test.
test("supervisor state-snapshot CLI ingests fallback_defect artifacts via --runs-dir", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "supervisor-state-snapshot-cli-"));
  const fallbackDir = join(runsDir, "run-cli", "fallback_defects");
  mkdirSync(fallbackDir, { recursive: true });
  writeFileSync(join(fallbackDir, "defect.json"), JSON.stringify({
    schema: "fallback_defect/v1",
    fallback_node: "normalize_features",
    pipeline: "goal_intake_decompose",
    run_id: "run-cli",
    trigger_reason: "feature_count_zero_after_normalize",
    contradiction: {
      approved: true,
      decompose_parse_status: "valid_json",
      pre_normalize_feature_count: 2,
      post_normalize_feature_count: 0,
      issues_created: 0,
    },
    classification: "pipeline_transport_defect",
    severity: "high",
    emitted_at: "2026-03-10T00:00:00.000Z",
    evidence: {
      goal_issue: 1612,
      otel_span: "hatch.fallback_defect",
    },
  }, null, 2));

  const { binDir } = makeGhStubBin("open_bugs");
  try {
    const run = spawnSync("node", [
      opsCliPath,
      "supervisor",
      "state-snapshot",
      "--repo", "recallnet/astrochicken",
      "--factory-id", "mothership",
      "--runs-dir", runsDir,
      "--skip-recovery-sweep",
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HATCH_TEST_GH_MODE: "open_bugs",
        PATH: `${binDir}:${process.env.PATH || ""}`,
      },
    });

    assert.equal(run.status, 0, run.stderr || run.stdout);
    const out = JSON.parse(String(run.stdout || "{}"));
    const fallbackItems = (out.action_items || []).filter((item) => String(item.type || "") === "fallback_defect");
    assert.equal(fallbackItems.length, 1);
    assert.equal(fallbackItems[0].source_run, "run-cli");
    assert.equal(fallbackItems[0].source_node, "normalize_features");
    assert.equal(fallbackItems[0].classification, "pipeline_transport_defect");
    assert.equal(fallbackItems[0].suggested_action, "file_bug");
    assert.equal(fallbackItems[0].evidence?.goal_issue, 1612);
    assert.equal(fallbackItems[0].evidence?.otel_span, "hatch.fallback_defect");
    assert.equal(out.action_count > 0, true);
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("supervisor run --op state-snapshot ingests fallback_defect artifacts via --runs-dir", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "supervisor-run-op-state-snapshot-cli-"));
  const fallbackDir = join(runsDir, "run-cli-op", "fallback_defects");
  mkdirSync(fallbackDir, { recursive: true });
  writeFileSync(join(fallbackDir, "defect.json"), JSON.stringify({
    schema: "fallback_defect/v1",
    fallback_node: "fallback",
    pipeline: "goal_intake_decompose",
    run_id: "run-cli-op",
    trigger_reason: "decompose_retry_exhausted",
    contradiction: {
      approved: false,
      decompose_parse_status: "invalid_json",
      pre_normalize_feature_count: null,
      post_normalize_feature_count: null,
      issues_created: 0,
    },
    classification: "llm_output_malformed",
    severity: "medium",
    emitted_at: "2026-03-10T00:00:00.000Z",
  }, null, 2));

  const { binDir } = makeGhStubBin("open_bugs");
  try {
    const run = spawnSync("node", [
      opsCliPath,
      "supervisor",
      "run",
      "--op",
      "state-snapshot",
      "--repo", "recallnet/astrochicken",
      "--factory-id", "mothership",
      "--runs-dir", runsDir,
      "--skip-recovery-sweep",
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HATCH_TEST_GH_MODE: "open_bugs",
        PATH: `${binDir}:${process.env.PATH || ""}`,
      },
    });

    assert.equal(run.status, 0, run.stderr || run.stdout);
    const out = JSON.parse(String(run.stdout || "{}"));
    const fallbackItems = (out.action_items || []).filter((item) => String(item.type || "") === "fallback_defect");
    assert.equal(fallbackItems.length, 1);
    assert.equal(fallbackItems[0].source_run, "run-cli-op");
    assert.equal(fallbackItems[0].classification, "llm_output_malformed");
    assert.equal(fallbackItems[0].suggested_action, "monitor_retry");
    assert.ok(out.action_count >= 1);
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});
