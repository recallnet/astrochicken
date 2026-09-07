import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildFallbackDefectSignal,
  persistFallbackDefectSignal,
  emitFallbackDefectTelemetry,
  emitAndPersistFallbackDefectSignal,
} from "../../src/commands/goal-fallback-defect.ts";

const FIXED_NOW = new Date("2026-03-10T00:00:00.000Z");

test("buildFallbackDefectSignal classifies normalize contradiction as pipeline transport defect", () => {
  const signal = buildFallbackDefectSignal({
    fallbackNode: "normalize_features",
    pipeline: "goal_intake_decompose",
    runId: "run-123",
    triggerReason: "feature_count_zero_after_normalize",
    approved: "true",
    decomposeParseStatus: "valid_json",
    preNormalizeFeatureCount: "3",
    postNormalizeFeatureCount: "0",
    issuesCreated: "0",
    now: FIXED_NOW,
  });

  assert.equal(signal.schema, "fallback_defect/v1");
  assert.equal(signal.classification, "pipeline_transport_defect");
  assert.equal(signal.severity, "high");
  assert.equal(signal.suggested_action, "file_bug");
  assert.equal(signal.contradiction.approved, true);
  assert.equal(signal.contradiction.pre_normalize_feature_count, 3);
  assert.equal(signal.contradiction.post_normalize_feature_count, 0);
  assert.equal(signal.contradiction.issues_created, 0);
});

test("buildFallbackDefectSignal maps parse failures to llm_output_malformed", () => {
  const signal = buildFallbackDefectSignal({
    fallbackNode: "fallback",
    pipeline: "goal_intake_decompose",
    runId: "run-124",
    triggerReason: "decompose_retry_exhausted",
    decomposeParseStatus: "invalid_json",
    now: FIXED_NOW,
  });

  assert.equal(signal.classification, "llm_output_malformed");
  assert.equal(signal.severity, "medium");
  assert.equal(signal.suggested_action, "retry");
});

test("buildFallbackDefectSignal maps empty outputs to llm_output_empty", () => {
  const signal = buildFallbackDefectSignal({
    fallbackNode: "fallback",
    pipeline: "goal_intake_decompose",
    runId: "run-125",
    triggerReason: "decompose_retry_exhausted",
    decomposeParseStatus: "empty_array",
    now: FIXED_NOW,
  });

  assert.equal(signal.classification, "llm_output_empty");
  assert.equal(signal.suggested_action, "retry");
});

test("buildFallbackDefectSignal classifies external trigger reasons as external_service_failure", () => {
  const signal = buildFallbackDefectSignal({
    fallbackNode: "fallback",
    pipeline: "goal_intake_decompose",
    runId: "run-126",
    triggerReason: "github_api_timeout",
    now: FIXED_NOW,
  });

  assert.equal(signal.classification, "external_service_failure");
  assert.equal(signal.suggested_action, "monitor");
});

test("persistFallbackDefectSignal writes artifact under run artifacts directory", () => {
  const root = mkdtempSync(join(tmpdir(), "goal-fallback-defect-"));
  const runsDir = join(root, "runs");
  mkdirSync(runsDir, { recursive: true });

  try {
    const signal = buildFallbackDefectSignal({
      fallbackNode: "normalize_features",
      pipeline: "goal_intake_decompose",
      runId: "run-127",
      triggerReason: "feature_count_zero_after_normalize",
      approved: "true",
      decomposeParseStatus: "valid_json",
      preNormalizeFeatureCount: "2",
      postNormalizeFeatureCount: "0",
      issuesCreated: "0",
      now: FIXED_NOW,
    });

    const artifactPath = persistFallbackDefectSignal({
      signal,
      runId: "run-127",
      runsDir,
      now: FIXED_NOW,
    });

    assert.match(artifactPath, /run-127\/artifacts\/fallback-defects\/fallback-defect-/);

    const persisted = JSON.parse(readFileSync(artifactPath, "utf8"));
    assert.equal(persisted.schema, "fallback_defect/v1");
    assert.equal(persisted.fallback_node, "normalize_features");
    assert.equal(persisted.pipeline, "goal_intake_decompose");
    assert.equal(persisted.run_id, "run-127");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("emitFallbackDefectTelemetry emits hatch.fallback_defect OTEL event", () => {
  const signal = buildFallbackDefectSignal({
    fallbackNode: "normalize_features",
    pipeline: "goal_intake_decompose",
    runId: "run-otel-1",
    triggerReason: "feature_count_zero_after_normalize",
    approved: "true",
    decomposeParseStatus: "valid_json",
    preNormalizeFeatureCount: "2",
    postNormalizeFeatureCount: "0",
    issuesCreated: "0",
    now: FIXED_NOW,
  });

  const previousMode = process.env.OTEL_MODE;
  process.env.OTEL_MODE = "stdout";

  let stdout = "";
  let stderr = "";
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  process.stdout.write = ((chunk) => { stdout += String(chunk); return true; });
  process.stderr.write = ((chunk) => { stderr += String(chunk); return true; });

  try {
    emitFallbackDefectTelemetry(signal);
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    if (previousMode === undefined) delete process.env.OTEL_MODE;
    else process.env.OTEL_MODE = previousMode;
  }

  assert.equal(stdout, "");
  assert.match(stderr, /^OTEL_EVENT /);
  assert.match(stderr, /"event_name":"hatch\.fallback_defect"/);
  assert.match(stderr, /"classification":"pipeline_transport_defect"/);
  assert.match(stderr, /"fallback_node":"normalize_features"/);
});

test("emitAndPersistFallbackDefectSignal composes signal persistence and telemetry", () => {
  const root = mkdtempSync(join(tmpdir(), "goal-fallback-defect-compose-"));
  const runsDir = join(root, "runs");
  mkdirSync(runsDir, { recursive: true });

  const previousOtelMode = process.env.OTEL_MODE;
  process.env.OTEL_MODE = "off";

  try {
    const out = emitAndPersistFallbackDefectSignal({
      fallbackNode: "normalize_features",
      pipeline: "goal_intake_decompose",
      runId: "run-128",
      triggerReason: "feature_count_zero_after_normalize",
      approved: "true",
      decomposeParseStatus: "valid_json",
      preNormalizeFeatureCount: "2",
      postNormalizeFeatureCount: "0",
      issuesCreated: "0",
      runsDir,
      now: FIXED_NOW,
    });

    assert.equal(out.signal.classification, "pipeline_transport_defect");
    assert.match(out.artifact_path, /run-128\/artifacts\/fallback-defects\/fallback-defect-/);
    assert.equal(JSON.parse(readFileSync(out.artifact_path, "utf8")).run_id, "run-128");
  } finally {
    if (previousOtelMode === undefined) delete process.env.OTEL_MODE;
    else process.env.OTEL_MODE = previousOtelMode;
    rmSync(root, { recursive: true, force: true });
  }
});
