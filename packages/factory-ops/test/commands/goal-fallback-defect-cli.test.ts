import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

function runEmitFallbackDefect(args = [], { otelMode = "off" } = {}) {
  const run = spawnSync("node", [opsCliPath, "goal", "emit-fallback-defect", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      OTEL_MODE: otelMode,
    },
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout || "{}");
  return { run, out };
}

function parseOtelEvent(stderr = "") {
  const line = String(stderr || "")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith("OTEL_EVENT "));
  assert.ok(line, `expected OTEL_EVENT line in stderr, got:\n${stderr}`);
  return JSON.parse(line.replace(/^OTEL_EVENT\s+/, ""));
}

test("goal emit-fallback-defect CLI emits canonical classification payloads and persists artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "goal-fallback-defect-cli-"));

  try {
    const cases = [
      {
        name: "pipeline transport contradiction",
        runId: "run-cli-pipeline-transport",
        args: [
          "--fallback-node", "normalize_features",
          "--pipeline", "goal_intake_decompose",
          "--run-id", "run-cli-pipeline-transport",
          "--trigger-reason", "feature_count_zero_after_normalize",
          "--approved", "true",
          "--decompose-parse-status", "valid_json",
          "--pre-normalize-feature-count", "3",
          "--post-normalize-feature-count", "0",
          "--issues-created", "0",
          "--goal-issue-number", "1614",
          "--runs-dir", root,
        ],
        expected: {
          fallbackNode: "normalize_features",
          pipeline: "goal_intake_decompose",
          triggerReason: "feature_count_zero_after_normalize",
          classification: "pipeline_transport_defect",
          severity: "high",
          suggestedAction: "file_bug",
          contradiction: {
            approved: true,
            decompose_parse_status: "valid_json",
            pre_normalize_feature_count: 3,
            post_normalize_feature_count: 0,
            issues_created: 0,
          },
          goalIssue: 1614,
        },
      },
      {
        name: "llm malformed",
        runId: "run-cli-llm-malformed",
        args: [
          "--fallback-node", "fallback",
          "--pipeline", "goal_intake_decompose",
          "--run-id", "run-cli-llm-malformed",
          "--trigger-reason", "decompose_retry_exhausted",
          "--decompose-parse-status", "invalid_json",
          "--issues-created", "0",
          "--runs-dir", root,
        ],
        expected: {
          fallbackNode: "fallback",
          pipeline: "goal_intake_decompose",
          triggerReason: "decompose_retry_exhausted",
          classification: "llm_output_malformed",
          severity: "medium",
          suggestedAction: "retry",
          contradiction: {
            decompose_parse_status: "invalid_json",
            issues_created: 0,
          },
        },
      },
      {
        name: "llm empty",
        runId: "run-cli-llm-empty",
        args: [
          "--fallback-node", "fallback",
          "--pipeline", "goal_intake_decompose",
          "--run-id", "run-cli-llm-empty",
          "--trigger-reason", "decompose_retry_exhausted",
          "--decompose-parse-status", "empty_array",
          "--issues-created", "0",
          "--runs-dir", root,
        ],
        expected: {
          fallbackNode: "fallback",
          pipeline: "goal_intake_decompose",
          triggerReason: "decompose_retry_exhausted",
          classification: "llm_output_empty",
          severity: "medium",
          suggestedAction: "retry",
          contradiction: {
            decompose_parse_status: "empty_array",
            issues_created: 0,
          },
        },
      },
      {
        name: "contract violation",
        runId: "run-cli-contract",
        args: [
          "--fallback-node", "normalize_features",
          "--pipeline", "goal_intake_decompose",
          "--run-id", "run-cli-contract",
          "--trigger-reason", "schema_validation_failed",
          "--classification", "contract_violation",
          "--issues-created", "0",
          "--runs-dir", root,
        ],
        expected: {
          fallbackNode: "normalize_features",
          pipeline: "goal_intake_decompose",
          triggerReason: "schema_validation_failed",
          classification: "contract_violation",
          severity: "high",
          suggestedAction: "file_bug",
          contradiction: {
            issues_created: 0,
          },
        },
      },
      {
        name: "external service failure",
        runId: "run-cli-external",
        args: [
          "--fallback-node", "fallback",
          "--pipeline", "goal_intake_decompose",
          "--run-id", "run-cli-external",
          "--trigger-reason", "github_api_timeout",
          "--issues-created", "0",
          "--runs-dir", root,
        ],
        expected: {
          fallbackNode: "fallback",
          pipeline: "goal_intake_decompose",
          triggerReason: "github_api_timeout",
          classification: "external_service_failure",
          severity: "medium",
          suggestedAction: "monitor",
          contradiction: {
            issues_created: 0,
          },
        },
      },
    ];

    for (const fixture of cases) {
      const { out } = runEmitFallbackDefect(fixture.args, { otelMode: "off" });

      assert.equal(out.signal.schema, "fallback_defect/v1", fixture.name);
      assert.equal(out.signal.fallback_node, fixture.expected.fallbackNode, fixture.name);
      assert.equal(out.signal.pipeline, fixture.expected.pipeline, fixture.name);
      assert.equal(out.signal.run_id, fixture.runId, fixture.name);
      assert.equal(out.signal.trigger_reason, fixture.expected.triggerReason, fixture.name);
      assert.equal(out.signal.classification, fixture.expected.classification, fixture.name);
      assert.equal(out.signal.severity, fixture.expected.severity, fixture.name);
      assert.equal(out.signal.suggested_action, fixture.expected.suggestedAction, fixture.name);

      if (fixture.expected.goalIssue) {
        assert.equal(out.signal.evidence?.goal_issue, fixture.expected.goalIssue, fixture.name);
      }

      for (const [key, value] of Object.entries(fixture.expected.contradiction || {})) {
        assert.equal(out.signal.contradiction?.[key], value, `${fixture.name}: contradiction.${key}`);
      }

      assert.ok(out.artifact_path, `${fixture.name}: artifact path must exist`);
      assert.equal(existsSync(out.artifact_path), true, `${fixture.name}: artifact file missing`);

      const persisted = JSON.parse(readFileSync(out.artifact_path, "utf8"));
      assert.equal(persisted.schema, "fallback_defect/v1", fixture.name);
      assert.equal(persisted.fallback_node, fixture.expected.fallbackNode, fixture.name);
      assert.equal(persisted.pipeline, fixture.expected.pipeline, fixture.name);
      assert.equal(persisted.run_id, fixture.runId, fixture.name);
      assert.equal(persisted.classification, fixture.expected.classification, fixture.name);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("goal emit-fallback-defect CLI emits hatch.fallback_defect OTEL event with required attributes", () => {
  const root = mkdtempSync(join(tmpdir(), "goal-fallback-defect-cli-otel-"));

  try {
    const runId = "run-cli-otel";
    const { run, out } = runEmitFallbackDefect([
      "--fallback-node", "normalize_features",
      "--pipeline", "goal_intake_decompose",
      "--run-id", runId,
      "--trigger-reason", "feature_count_zero_after_normalize",
      "--approved", "true",
      "--decompose-parse-status", "valid_json",
      "--post-normalize-feature-count", "0",
      "--issues-created", "0",
      "--runs-dir", root,
    ], { otelMode: "stdout" });

    assert.equal(out.signal.classification, "pipeline_transport_defect");

    const otelEvent = parseOtelEvent(run.stderr || "");
    assert.equal(otelEvent.event_name, "hatch.fallback_defect");
    assert.equal(otelEvent.attributes?.classification, "pipeline_transport_defect");
    assert.equal(otelEvent.attributes?.severity, "high");
    assert.equal(otelEvent.attributes?.pipeline, "goal_intake_decompose");
    assert.equal(otelEvent.attributes?.fallback_node, "normalize_features");
    assert.equal(otelEvent.attributes?.run_id, runId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
