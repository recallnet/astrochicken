import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildStateSnapshot, evaluateOpenBugGate } from "../../src/commands/supervisor-state-snapshot.ts";

function addLabelsToIssues(issues, labelName) {
  return issues.map((i) => {
    const existing = Array.isArray(i.labels) ? i.labels : [];
    const hasLabel = existing.some((l) => (l?.name || l) === labelName);
    return hasLabel ? i : { ...i, labels: [...existing, { name: labelName }] };
  });
}

function makeGhStub({
  features = [],
  waveReady = [],
  quarantined = [],
  bugs = [],
  human = [],
  humanViews = {},
  unlabeled = [],
  goals = [],
  milestones = [],
  issueStates = {},
  issueViews = {},
} = {}) {
  // Unified fetch: combine all issue types with appropriate labels for in-memory filtering.
  const allIssues = [
    ...addLabelsToIssues(features, "feature"),
    ...addLabelsToIssues(goals, "goal"),
    ...addLabelsToIssues(bugs, "bug"),
    ...addLabelsToIssues(human, "human"),
    ...addLabelsToIssues(quarantined, "quarantined"),
    ...waveReady,
    ...unlabeled,
  ];
  // Deduplicate by issue number (features/goals may overlap with waveReady etc.)
  const seen = new Set();
  const deduped = [];
  for (const issue of allIssues) {
    const num = Number(issue?.number || 0);
    if (num > 0 && !seen.has(num)) {
      seen.add(num);
      deduped.push(issue);
    }
  }

  return (args, fallback = []) => {
    const cmd = Array.isArray(args) ? args.join(" ") : "";

    // Unified open issue fetch (fetchAllOpenIssues)
    if (cmd.includes("issue list") && cmd.includes("--state open") && cmd.includes("--limit 500")) {
      return deduped;
    }

    // GraphQL batch queries (fetchIssueMetadataBatch, fetchIssueStateBatch, fetchIssueCommentsBatch)
    if (cmd.includes("api graphql")) {
      const queryArg = args.find((a) => String(a).startsWith("query=")) || "";
      const query = String(queryArg);
      const matches = [...query.matchAll(/i(\d+):\s*issue\(number:(\d+)\)/g)];
      const repository = {};
      for (const m of matches) {
        const issueNumber = Number(m[2]);
        // Check if query requests comments (fetchIssueCommentsBatch)
        if (query.includes("comments(")) {
          const view = humanViews[issueNumber] || { comments: [], state: "OPEN" };
          repository[`i${issueNumber}`] = {
            state: String(view.state || "OPEN"),
            comments: { nodes: (view.comments || []).map((c) => ({ body: c.body || "", author: { login: c.author?.login || "" } })) },
          };
        }
        // Check if query requests labels (fetchIssueMetadataBatch)
        else if (query.includes("labels(")) {
          const view = issueViews[issueNumber] || { number: issueNumber, state: issueStates[issueNumber] || "OPEN", labels: [], title: "" };
          repository[`i${issueNumber}`] = {
            number: view.number || issueNumber,
            state: String(view.state || issueStates[issueNumber] || "OPEN"),
            title: String(view.title || ""),
            labels: { nodes: Array.isArray(view.labels) ? view.labels.map((l) => ({ name: l?.name || l || "" })) : [] },
          };
        }
        // Check if query requests blockedBy (fetchBugBlockedByBatch)
        else if (query.includes("blockedBy(")) {
          repository[`i${issueNumber}`] = {
            blockedBy: { nodes: [] },
          };
        }
        // State-only query (fetchIssueStateBatch)
        else {
          repository[`i${issueNumber}`] = {
            state: issueStates[issueNumber] || "OPEN",
          };
        }
      }
      return { data: { repository } };
    }

    // Legacy: paginated milestones
    if (cmd.includes("/milestones?state=all&per_page=100")) return milestones;

    return fallback;
  };
}

test("buildStateSnapshot returns error when repo missing and factory config is unavailable", () => {
  const out = JSON.parse(buildStateSnapshot({ repo: "", factoryRoot: "/tmp/does-not-exist-factory-root" }));
  assert.equal(out.error, "missing_repo");
});

test("buildStateSnapshot emits factory/target/control-plane context identity fields", () => {
  const out = JSON.parse(buildStateSnapshot({
    repo: "example/external-factory",
    targetRepo: "example/external-factory",
    controlPlaneRepo: "recallnet/astrochicken",
    factoryId: "external/factory_supervisor",
    ghJsonFn: makeGhStub(),
    recoverySweepFn: () => ({ stale_runs: [] }),
    nowMs: 1_700_000_000_000,
    runsDir: join(process.cwd(), ".hatch", "runs"),
  }));

  assert.equal(out.factory_id, "external/factory_supervisor");
  assert.equal(out.gh_repo, "example/external-factory");
  assert.equal(out.target_repo, "example/external-factory");
  assert.equal(out.control_plane_repo, "recallnet/astrochicken");
  assert.equal(
    out.judge_context_scope_identity,
    "external/factory_supervisor::example/external-factory::recallnet/astrochicken",
  );
  assert.equal(out.context_scope?.factory_id, "external/factory_supervisor");
  assert.equal(out.context_scope?.target_repo, "example/external-factory");
  assert.equal(out.context_scope?.control_plane_repo, "recallnet/astrochicken");
});

test("evaluateOpenBugGate detects open bug count from snapshot payload", () => {
  const snapshot = JSON.stringify({ open_bug_batch: { total: 2, bugs: [{ number: 1 }, { number: 2 }] } });
  const out = evaluateOpenBugGate({ snapshot });
  assert.equal(out.has_open_bugs, "true");
  assert.equal(out.open_bug_count, 2);
  assert.deepEqual(out.issue_numbers, [1, 2]);
  assert.equal(out.parse_error, "");
});

test("evaluateOpenBugGate fails safe on invalid snapshot json", () => {
  const out = evaluateOpenBugGate({ snapshot: "{bad-json" });
  assert.equal(out.has_open_bugs, "false");
  assert.equal(out.open_bug_count, 0);
  assert.deepEqual(out.issue_numbers, []);
  assert.ok(String(out.parse_error || "").length > 0);
});

test("evaluateOpenBugGate accepts parsed snapshotOverride objects", () => {
  const out = evaluateOpenBugGate({
    snapshotOverride: {
      open_bugs: [
        { number: 1, title: "[bug] first" },
        { number: 2, title: "[bug] second" },
      ],
    },
  });
  assert.equal(out.has_open_bugs, "true");
  assert.equal(out.open_bug_count, 2);
  assert.deepEqual(out.issue_numbers, [1, 2]);
  assert.equal(out.parse_error, "");
});

test("evaluateOpenBugGate treats wave-issue-giveup bugs as non-blocking", () => {
  const snapshot = JSON.stringify({
    open_bugs: [
      { number: 605, title: "[bug] wave-issue-giveup-scope_mismatch: Issue #560 gave up after max review attempts" },
      { number: 999, title: "[bug] cli-runtime-crash: factory tick failed" },
    ],
  });
  const out = evaluateOpenBugGate({ snapshot });
  assert.equal(out.has_open_bugs, "true");
  assert.equal(out.open_bug_count, 1);
  assert.deepEqual(out.issue_numbers, [999]);
  assert.equal(out.parse_error, "");
});

test("buildStateSnapshot excludes stale wave give-up bugs when source issue is closed", () => {
  const ghJsonFn = makeGhStub({
    bugs: [
      {
        number: 758,
        title: "[bug] wave-issue-giveup-qa_infrastructure: Issue #630 gave up after max review attempts (qa_infrastructure)",
        createdAt: "2026-03-05T13:00:56Z",
        body: "Bug-Signature: sha256:abc",
      },
    ],
    issueStates: {
      630: "CLOSED",
    },
  });
  const recoverySweepFn = () => ({ stale_runs: [] });

  const snapshotObj = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn,
    recoverySweepFn,
    nowMs: 1_700_100_000_000,
    runsDir: join(process.cwd(), ".hatch", "runs"),
  }));

  assert.equal((snapshotObj.open_bugs || []).length, 0, "closed-source wave give-up bugs must not block open-bug gate");

  const gate = evaluateOpenBugGate({ snapshot: JSON.stringify(snapshotObj) });
  assert.equal(gate.has_open_bugs, "false");
  assert.equal(gate.open_bug_count, 0);
  assert.deepEqual(gate.issue_numbers, []);
});

test("buildStateSnapshot does not classify open feature under closed goal as orphaned", () => {
  const ghJsonFn = makeGhStub({
    features: [
      {
        number: 2331,
        title: "Regression gates",
        body: "## Parent Goal\nCloses as part of #2199",
        createdAt: "2026-03-18T05:08:33Z",
        labels: [{ name: "feature" }],
      },
    ],
    issueViews: {
      2199: {
        number: 2199,
        state: "CLOSED",
        title: "Goal: Medium and provisional hard routing onto the current issue path",
        labels: [{ name: "goal" }],
      },
    },
  });

  const snapshotObj = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn,
    recoverySweepFn: () => ({ stale_runs: [] }),
    nowMs: 1_710_744_000_000,
    runsDir: join(process.cwd(), ".hatch", "runs"),
  }));

  assert.deepEqual(snapshotObj.orphan_features || [], []);
  assert.equal((snapshotObj.closed_goal_owned_features || []).length, 1);
  assert.equal(snapshotObj.closed_goal_owned_features[0].number, 2331);
  const item = (snapshotObj.action_items || []).find((entry) => entry.issue === 2331);
  assert.ok(item, "expected follow-up action item for feature under closed goal");
  assert.equal(item.problem, "feature remains open under a closed parent goal");
});

function writeFallbackDefectArtifact({
  runsDir,
  runId,
  fileName = "fallback-defect.json",
  payload,
  artifactVariant = "artifacts-hyphen",
} = {}) {
  const variantDirByKey = {
    fallback_underscore: join(runsDir, runId, "fallback_defects"),
    fallback_hyphen: join(runsDir, runId, "fallback-defects"),
    artifacts_underscore: join(runsDir, runId, "artifacts", "fallback_defects"),
    artifacts_hyphen: join(runsDir, runId, "artifacts", "fallback-defects"),
  };
  const artifactDir = variantDirByKey[artifactVariant] || variantDirByKey.artifacts_hyphen;
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, fileName);
  writeFileSync(artifactPath, typeof payload === "string" ? payload : JSON.stringify(payload, null, 2));
  return artifactPath;
}

test("buildStateSnapshot surfaces fallback_defect artifacts as action items", () => {
  const ghJsonFn = makeGhStub();
  const recoverySweepFn = () => ({ stale_runs: [] });
  const runsDir = mkdtempSync(join(tmpdir(), "snapshot-fallback-defect-"));

  writeFallbackDefectArtifact({
    runsDir,
    runId: "run-a",
    fileName: "a.json",
    artifactVariant: "fallback_underscore",
    payload: {
      schema: "fallback_defect/v1",
      fallback_node: "normalize_features",
      pipeline: "goal_intake_decompose",
      run_id: "run-a",
      trigger_reason: "feature_count_zero_after_normalize",
      contradiction: {
        approved: true,
        decompose_parse_status: "valid_json",
        pre_normalize_feature_count: 3,
        post_normalize_feature_count: 0,
        issues_created: 0,
      },
      classification: "pipeline_transport_defect",
      severity: "high",
      emitted_at: "2026-03-10T00:00:00.000Z",
      evidence: {
        goal_issue: 1541,
        otel_span: "hatch.fallback_defect",
      },
    },
  });

  const out = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn,
    recoverySweepFn,
    nowMs: Date.parse("2026-03-10T00:10:00.000Z"),
    runsDir,
  }));

  const item = (out.action_items || []).find((entry) => String(entry.type || "") === "fallback_defect");
  assert.ok(item, "expected fallback_defect action item");
  assert.equal(item.source_run, "run-a");
  assert.equal(item.source_node, "normalize_features");
  assert.equal(item.classification, "pipeline_transport_defect");
  assert.equal(item.suggested_action, "file_bug");
  assert.match(String(item.summary || ""), /approved\/valid parse/i);
  assert.equal(item.evidence?.goal_issue, 1541);
  assert.equal(item.evidence?.otel_span, "hatch.fallback_defect");
  assert.equal(item.evidence?.contradiction?.issues_created, 0);
  assert.equal(item.diagnostics?.recurrence_24h_count, 1);
  assert.equal(item.diagnostics?.recurrence_1h_count, 1);
  assert.equal(item.diagnostics?.escalated, true);
  assert.equal(out.action_count, 1);
});

test("buildStateSnapshot does not add fallback_defect action items when no defect artifacts exist", () => {
  const out = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn: makeGhStub(),
    recoverySweepFn: () => ({ stale_runs: [] }),
    nowMs: Date.parse("2026-03-10T00:10:00.000Z"),
    runsDir: mkdtempSync(join(tmpdir(), "snapshot-no-fallback-defect-")),
  }));

  const fallbackItems = (out.action_items || []).filter((entry) => String(entry.type || "") === "fallback_defect");
  assert.equal(fallbackItems.length, 0);
});

test("buildStateSnapshot skips closed fallback bug history query when there are no fallback defect signals", () => {
  const calls = [];
  const out = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn: (args, fallback = []) => {
      const cmd = Array.isArray(args) ? args.join(" ") : "";
      calls.push(cmd);
      return fallback;
    },
    recoverySweepFn: () => ({ stale_runs: [] }),
    nowMs: Date.parse("2026-03-10T00:10:00.000Z"),
    runsDir: mkdtempSync(join(tmpdir(), "snapshot-no-fallback-history-")),
  }));

  assert.equal((out.action_items || []).length, 0);
  assert.equal(
    calls.some((cmd) => cmd.includes("issue list --repo recallnet/astrochicken --state closed --label bug")),
    false,
    "closed bug history should not be queried without fallback signals",
  );
});

test("buildStateSnapshot surfaces durable recovery packets as supervisor action items", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "snapshot-recovery-packets-"));
  const packetDir = join(
    runsDir,
    "run-judge-1",
    "packets",
    "judge_context_contract_recovery",
  );
  mkdirSync(packetDir, { recursive: true });
  writeFileSync(join(packetDir, "judge_context_contract_recovery_abc.json"), JSON.stringify({
    schema_version: "remediation_packet/v1",
    packet_type: "judge_context_contract_recovery",
    packet_id: "judge_context_contract_recovery_abc",
    created_at: "2026-03-10T00:00:00.000Z",
    factory_id: "mothership",
    run_id: "run-judge-1",
    pipeline: "wave_execute",
    node_id: "build_judge_context_recovery_packet",
    target_repo: "recallnet/astrochicken",
    control_plane_repo: "recallnet/astrochicken",
    intent: "Recover failed judge context contract.",
    inspection_commands: ["cat '/tmp/judge-context.json'"],
    execution_commands: ["Rebuild the contract and rerun validation."],
    verify_commands: ["hatch-ops factory tick-status"],
    expected_postconditions: ["judge contract validates successfully"],
    retry_policy: { max_attempts: 1, on_failure: "escalate_with_packet_context", recheck_after: "after_repo_fix" },
    requires_commit: false,
    requires_repo_fix: true,
    resource_refs: {
      milestone_title: "goal-1-wave-1",
      ready_issue_number: "205",
      gate_code: "judge_context_scenarios_missing",
      route_code: "scenario_registry_missing",
      error_text: "judge_context_scenarios_missing",
    },
    preserve_work: {
      preserve_work_required: true,
    },
    operator_prompt: "Start with the packet and restore the judge context contract.",
  }, null, 2));

  const out = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    ghJsonFn: makeGhStub(),
    recoverySweepFn: () => ({ stale_runs: [] }),
    nowMs: Date.parse("2026-03-10T01:00:00.000Z"),
    runsDir,
  }));

  const item = (out.action_items || []).find((entry) => entry.type === "recovery_packet");
  assert.ok(item, "expected durable recovery packet action item");
  assert.match(String(item.problem || ""), /judge_context_contract_recovery/);
  assert.equal(item.diagnostics?.packet_storage_class, "factory_run_packet");
  assert.equal(item.remediation_packet?.packet_type, "judge_context_contract_recovery");
  assert.match(String(item.suggested_action || ""), /Start with the packet/);
});

test("buildStateSnapshot keeps low-rate review_retry_exhausted_force_merge as non-bug telemetry", () => {
  const ghJsonFn = makeGhStub();
  const recoverySweepFn = () => ({ stale_runs: [] });
  const runsDir = mkdtempSync(join(tmpdir(), "snapshot-review-force-merge-low-"));

  writeFallbackDefectArtifact({
    runsDir,
    runId: "run-review-low",
    fileName: "review-low.json",
    artifactVariant: "artifacts_hyphen",
    payload: {
      schema: "fallback_defect/v1",
      fallback_node: "report_approved",
      pipeline: "wave_issue_execute",
      run_id: "run-review-low",
      trigger_reason: "review_retry_exhausted_force_merge",
      contradiction: {},
      classification: "contract_violation",
      severity: "high",
      emitted_at: "2026-03-10T20:59:00.000Z",
      evidence: {
        goal_issue: 1565,
      },
    },
  });

  const out = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn,
    recoverySweepFn,
    nowMs: Date.parse("2026-03-10T21:00:00.000Z"),
    runsDir,
  }));

  const item = (out.action_items || []).find((entry) => String(entry.type || "") === "fallback_defect");
  assert.ok(item, "expected fallback_defect action item");
  assert.equal(item.diagnostics?.recurrence_24h_count, 1);
  assert.equal(item.suggested_action, "log_and_monitor");
  assert.equal(item.diagnostics?.escalated, false);
  assert.equal(item.diagnostics?.escalation_reason, "force_merge_degraded_mode_expected");
});

test("buildStateSnapshot escalates high-rate review_retry_exhausted_force_merge into file_bug action", () => {
  const ghJsonFn = makeGhStub();
  const recoverySweepFn = () => ({ stale_runs: [] });
  const runsDir = mkdtempSync(join(tmpdir(), "snapshot-review-force-merge-high-"));

  for (let index = 1; index <= 10; index += 1) {
    writeFallbackDefectArtifact({
      runsDir,
      runId: `run-review-high-${index}`,
      fileName: `review-high-${index}.json`,
      artifactVariant: "artifacts_hyphen",
      payload: {
        schema: "fallback_defect/v1",
        fallback_node: "report_approved",
        pipeline: "wave_issue_execute",
        run_id: `run-review-high-${index}`,
        trigger_reason: "review_retry_exhausted_force_merge",
        contradiction: {},
        classification: "contract_violation",
        severity: "high",
        emitted_at: "2026-03-10T20:59:00.000Z",
        evidence: {
          goal_issue: 1565,
        },
      },
    });
  }

  const out = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn,
    recoverySweepFn,
    nowMs: Date.parse("2026-03-10T21:00:00.000Z"),
    runsDir,
  }));

  const items = (out.action_items || []).filter((entry) => String(entry.type || "") === "fallback_defect");
  assert.equal(items.length, 10);
  for (const item of items) {
    assert.equal(item.diagnostics?.recurrence_24h_count, 10);
    assert.equal(item.suggested_action, "file_bug");
    assert.equal(item.diagnostics?.escalated, true);
    assert.equal(item.diagnostics?.escalation_reason, "force_merge_rate_exceeds_threshold");
  }
});

test("buildStateSnapshot fallback_defect recurrence policy escalates deterministically", () => {
  const ghJsonFn = makeGhStub();
  const recoverySweepFn = () => ({ stale_runs: [] });
  const runsDir = mkdtempSync(join(tmpdir(), "snapshot-fallback-recurrence-"));

  const llmTrigger = "decompose_retry_exhausted";
  for (let index = 1; index <= 3; index += 1) {
    writeFallbackDefectArtifact({
      runsDir,
      runId: `llm-${index}`,
      fileName: `llm-${index}.json`,
      artifactVariant: "artifacts_hyphen",
      payload: {
        schema: "fallback_defect/v1",
        fallback_node: "fallback",
        pipeline: "goal_intake_decompose",
        run_id: `llm-${index}`,
        trigger_reason: llmTrigger,
        contradiction: {
          approved: false,
          decompose_parse_status: "invalid_json",
          pre_normalize_feature_count: null,
          post_normalize_feature_count: null,
          issues_created: 0,
        },
        classification: "llm_output_malformed",
        severity: "medium",
        emitted_at: "2026-03-10T00:10:00.000Z",
      },
    });
  }

  const externalTrigger = "github_api_timeout";
  for (let index = 1; index <= 4; index += 1) {
    writeFallbackDefectArtifact({
      runsDir,
      runId: `external-${index}`,
      fileName: `external-${index}.json`,
      artifactVariant: "artifacts_underscore",
      payload: {
        schema: "fallback_defect/v1",
        fallback_node: "persist_wave",
        pipeline: "wave_execute",
        run_id: `external-${index}`,
        trigger_reason: externalTrigger,
        contradiction: {
          approved: null,
          decompose_parse_status: "",
          pre_normalize_feature_count: null,
          post_normalize_feature_count: null,
          issues_created: null,
        },
        classification: "external_service_failure",
        severity: "medium",
        emitted_at: "2026-03-10T00:20:00.000Z",
      },
    });
  }

  const out = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn,
    recoverySweepFn,
    nowMs: Date.parse("2026-03-10T00:40:00.000Z"),
    runsDir,
  }));

  const fallbackItems = (out.action_items || []).filter((entry) => String(entry.type || "") === "fallback_defect");
  assert.equal(fallbackItems.length, 7);

  const llmEscalated = fallbackItems.find((entry) => entry.source_run === "llm-1");
  assert.ok(llmEscalated);
  assert.equal(llmEscalated.classification, "llm_output_malformed");
  assert.equal(llmEscalated.suggested_action, "file_bug");
  assert.equal(llmEscalated.diagnostics?.recurrence_24h_count, 3);
  assert.equal(llmEscalated.diagnostics?.escalated, true);

  const externalEscalated = fallbackItems.find((entry) => entry.source_run === "external-1");
  assert.ok(externalEscalated);
  assert.equal(externalEscalated.classification, "external_service_failure");
  assert.equal(externalEscalated.suggested_action, "file_bug");
  assert.equal(externalEscalated.diagnostics?.recurrence_1h_count, 4);
  assert.equal(externalEscalated.diagnostics?.escalated, true);
});

test("buildStateSnapshot fallback_defect parse errors populate snapshot_errors without aborting", () => {
  const ghJsonFn = makeGhStub();
  const recoverySweepFn = () => ({ stale_runs: [] });
  const runsDir = mkdtempSync(join(tmpdir(), "snapshot-fallback-errors-"));

  writeFallbackDefectArtifact({
    runsDir,
    runId: "valid-run",
    fileName: "valid.json",
    payload: {
      schema: "fallback_defect/v1",
      fallback_node: "fallback",
      pipeline: "goal_intake_decompose",
      run_id: "valid-run",
      trigger_reason: "decompose_retry_exhausted",
      contradiction: {
        approved: false,
        decompose_parse_status: "empty_array",
        pre_normalize_feature_count: null,
        post_normalize_feature_count: null,
        issues_created: 0,
      },
      classification: "llm_output_empty",
      severity: "medium",
      emitted_at: "2026-03-10T00:00:00.000Z",
    },
  });

  const invalidDir = join(runsDir, "broken-run", "fallback_defects");
  mkdirSync(invalidDir, { recursive: true });
  writeFileSync(join(invalidDir, "broken.json"), "{not-json");

  const out = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn,
    recoverySweepFn,
    nowMs: Date.parse("2026-03-10T00:20:00.000Z"),
    runsDir,
  }));

  const fallbackItems = (out.action_items || []).filter((entry) => String(entry.type || "") === "fallback_defect");
  assert.equal(fallbackItems.length, 1);
  assert.equal(fallbackItems[0].source_run, "valid-run");
  assert.equal(out.action_count, 1);

  const errors = Array.isArray(out.snapshot_errors) ? out.snapshot_errors : [];
  assert.ok(errors.some((entry) => String(entry).includes("fallback_defect_parse_error:run=broken-run:file=broken.json")));
});

test("buildStateSnapshot emits reason-aware RUN_LIVENESS_INCIDENT action item", () => {
  const ghJsonFn = makeGhStub();
  const recoverySweepFn = () => ({
    stale_runs: [
      {
        runId: "abc123",
        reason: "pid_dead",
        ageSeconds: 1700,
        currentNode: "execute_issue",
        pipeline: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
      },
    ],
  });

  const out = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn,
    recoverySweepFn,
    nowMs: 1_700_000_000_000,
    runsDir: join(process.cwd(), ".hatch", "runs"),
  }));

  const incident = (out.action_items || []).find((item) => String(item.problem || "").includes("RUN_LIVENESS_INCIDENT"));
  assert.ok(incident, "expected RUN_LIVENESS_INCIDENT action item");
  assert.match(String(incident.problem || ""), /reason=pid_dead/);
  assert.ok(Array.isArray(incident.possible_resolutions));
  assert.ok(incident.possible_resolutions.some((r) => String(r.when || "").includes("pid_dead")));
  assert.equal(String(incident?.remediation_packet?.packet_type || ""), "run_liveness_recovery");
  assert.ok(Array.isArray(incident?.remediation_packet?.execution_commands));
  assert.ok(incident.remediation_packet.execution_commands.some((cmd) => String(cmd).includes("recovery-sweep")));
  assert.ok(Array.isArray(incident?.remediation_packet?.expected_postconditions));
});

test("buildStateSnapshot filters out stale runs with ephemeral temp-dir pipelines", () => {
  const ghJsonFn = makeGhStub();
  const recoverySweepFn = () => ({
    stale_runs: [
      {
        runId: "real-run",
        reason: "pid_dead",
        ageSeconds: 1700,
        currentNode: "build",
        pipeline: "factories/mothership/workflows/goal-execution/goal_execute.workflow-source.mjs",
      },
      {
        runId: "tmp-test-1",
        reason: "pid_dead",
        ageSeconds: 21,
        currentNode: "",
        pipeline: "/tmp/parent.dot",
      },
      {
        runId: "tmp-test-2",
        reason: "pid_dead",
        ageSeconds: 22,
        currentNode: "",
        pipeline: "/var/folders/py/ny6ntmz51k1bh0bt1dwtzfd40000gn/T/hatch-pipeline-timeout-s75wLh/parent.dot",
      },
      {
        runId: "tmp-test-3",
        reason: "pid_dead",
        ageSeconds: 18,
        currentNode: "",
        pipeline: "/tmp/sample.dot",
      },
    ],
  });

  const out = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn,
    recoverySweepFn,
    nowMs: 1_700_000_000_000,
    runsDir: join(process.cwd(), ".hatch", "runs"),
  }));

  const incidents = (out.action_items || []).filter((item) => String(item.problem || "").includes("RUN_LIVENESS_INCIDENT"));
  assert.equal(incidents.length, 1, "should only have 1 incident for the real factory run, not test runs");
  assert.match(String(incidents[0].problem || ""), /real-run/, "the surviving incident should be the real factory run");
});

test("buildStateSnapshot scopes managed api_only recovery sweep to stale-run cleanup without worktree scan", () => {
  const ghJsonFn = makeGhStub();
  const calls = [];
  const recoverySweepFn = (args = {}) => {
    calls.push(args);
    return { stale_runs: [] };
  };

  JSON.parse(buildStateSnapshot({
    repo: "example-org/example-notes",
    targetRepo: "example-org/example-notes",
    controlPlaneRepo: "recallnet/astrochicken",
    factoryId: "brainstorm",
    factoryConfig: {
      factory_id: "brainstorm",
      target_repo: "example-org/example-notes",
      control_plane_repo: "recallnet/astrochicken",
      workspace_mode: "api_only",
    },
    ghJsonFn,
    recoverySweepFn,
    nowMs: 1_700_000_000_000,
    runsDir: join(process.cwd(), ".hatch", "brainstorm", "runs"),
  }));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].skipWorktreeScan, true);
  assert.equal(String(calls[0].repoPath || ""), "");
});

test("buildStateSnapshot scopes managed checkout recovery sweep to the managed repo path", () => {
  const ghJsonFn = makeGhStub();
  const calls = [];
  const recoverySweepFn = (args = {}) => {
    calls.push(args);
    return { stale_runs: [] };
  };
  const prevFactoryContextRepoPath = process.env.FACTORY_CONTEXT_REPO_PATH;

  try {
    process.env.FACTORY_CONTEXT_REPO_PATH = "/tmp/managed-factory-home";
    JSON.parse(buildStateSnapshot({
      repo: "example-org/example-trading",
      targetRepo: "example-org/example-trading",
      controlPlaneRepo: "recallnet/astrochicken",
      factoryId: "example-trading",
      factoryConfig: {
        factory_id: "example-trading",
        target_repo: "example-org/example-trading",
        control_plane_repo: "recallnet/astrochicken",
        workspace_mode: "checkout",
        work_dir: "/tmp/wrong-fallback",
      },
      ghJsonFn,
      recoverySweepFn,
      nowMs: 1_700_000_000_000,
      runsDir: join(process.cwd(), ".hatch", "example-trading", "runs"),
    }));
  } finally {
    if (prevFactoryContextRepoPath === undefined) delete process.env.FACTORY_CONTEXT_REPO_PATH;
    else process.env.FACTORY_CONTEXT_REPO_PATH = prevFactoryContextRepoPath;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].skipWorktreeScan, false);
  assert.equal(calls[0].repoPath, "/tmp/managed-factory-home");
});

test("buildStateSnapshot can skip recovery sweep entirely for deterministic callers", () => {
  const ghJsonFn = makeGhStub();
  let calls = 0;
  const recoverySweepFn = () => {
    calls += 1;
    return { stale_runs: [{ run_id: "stale-1" }] };
  };

  const out = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
    factoryId: "mothership",
    factoryConfig: {
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      control_plane_repo: "recallnet/astrochicken",
      workspace_mode: "checkout",
    },
    ghJsonFn,
    recoverySweepFn,
    skipRecoverySweep: true,
    nowMs: 1_700_000_000_000,
  }));

  assert.equal(calls, 0);
  assert.equal((out.action_items || []).some((item) => String(item.problem || "").includes("RUN_LIVENESS_INCIDENT")), false);
});

test("buildStateSnapshot emits CLI_RUNTIME_CRASH action for local factory crashes", () => {
  const ghJsonFn = makeGhStub();
  const recoverySweepFn = () => ({ stale_runs: [] });
  const scanCliCrashesFn = () => ([
    {
      run_id: "r-1",
      pipeline: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
      node: "execute_issue",
      crash_type: "merge_marker_in_executable",
      file_path: "/tmp/nonexistent-cli-merge-marker.mjs",
      error_excerpt: "SyntaxError: Unexpected token '<<'",
    },
  ]);

  const out = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn,
    recoverySweepFn,
    scanCliCrashesFn,
    nowMs: 1_700_000_000_000,
    runsDir: join(process.cwd(), ".hatch", "runs"),
  }));

  const incident = (out.action_items || []).find((item) => String(item.problem || "").startsWith("CLI_RUNTIME_CRASH:"));
  assert.ok(incident, "expected CLI_RUNTIME_CRASH action item");
  assert.match(String(incident.suggested_action || ""), /APPLY_NOW/);
  assert.match(String(incident.suggested_action || ""), /no bug issue/i);
  assert.equal(String(incident?.diagnostics?.remediation_policy || ""), "LOCAL_FACTORY_IMMEDIATE_FIX");
  assert.equal(String(incident?.remediation_packet?.packet_type || ""), "local_cli_runtime_crash");
  assert.equal(Boolean(incident?.remediation_packet?.requires_commit), true);
  assert.equal(Boolean(incident?.remediation_packet?.requires_repo_fix), true);
  assert.ok(Array.isArray(incident?.remediation_packet?.verify_commands));
});

test("buildStateSnapshot routes non-local CLI runtime crashes to durable packet-first action items", () => {
  const ghJsonFn = makeGhStub();
  const recoverySweepFn = () => ({ stale_runs: [] });
  const scanCliCrashesFn = () => ([
    {
      run_id: "r-remote",
      pipeline: "factories/external/graphs/factory_supervisor_tick.dot",
      node: "supervisor_review",
      crash_type: "module_not_found",
      file_path: "/tmp/missing.mjs",
      error_excerpt: "ERR_MODULE_NOT_FOUND",
    },
  ]);

  const repoRoot = mkdtempSync(join(tmpdir(), "snapshot-remote-cli-crash-"));
  const runsDir = join(repoRoot, ".hatch", "external", "factory_supervisor", "runs");
  mkdirSync(runsDir, { recursive: true });

  const out = JSON.parse(buildStateSnapshot({
    repo: "example/external-factory",
    targetRepo: "example/external-factory",
    controlPlaneRepo: "recallnet/astrochicken",
    factoryId: "external/factory_supervisor",
    ghJsonFn,
    recoverySweepFn,
    scanCliCrashesFn,
    nowMs: 1_700_000_000_000,
    runsDir,
  }));

  const crashPacketItem = (out.persisted_packet_action_items || []).find(
    (item) => String(item?.remediation_packet?.packet_type || "") === "remote_cli_runtime_crash",
  );
  assert.ok(crashPacketItem, "expected persisted remote_cli_runtime_crash action item");
  assert.equal(String(crashPacketItem?.source || ""), "persisted_packet");
  assert.equal(Boolean(crashPacketItem?.packet_preferred), true);
  assert.equal(String(crashPacketItem?.remediation_packet?.handoff_kind || ""), "supervisor_recovery");
  assert.equal(String(crashPacketItem?.remediation_packet?.factory_id || ""), "external/factory_supervisor");
  assert.equal(String(crashPacketItem?.remediation_packet?.run_id || ""), "r-remote");
  assert.ok(
    crashPacketItem?.remediation_packet?.execution_commands?.some((cmd) => String(cmd).includes("supervisor emit-bug")),
    "remote crash packet must use supervisor emit-bug command",
  );
  assert.match(String(crashPacketItem?.suggested_action || ""), /--repo 'recallnet\/astrochicken'/);
  assert.match(String(crashPacketItem?.suggested_action || ""), /--source-factory 'external\/factory_supervisor'/);
  assert.match(String(crashPacketItem?.suggested_action || ""), /--source-repo 'example\/external-factory'/);
  assert.doesNotMatch(String(crashPacketItem?.suggested_action || ""), /gh issue create/);

  const staleSynthesisIncident = (out.action_items || []).find((item) => String(item.problem || "").startsWith("CLI_RUNTIME_CRASH:"));
  assert.equal(Boolean(staleSynthesisIncident), false, "durable packet should suppress duplicate synthesized crash action item");

  const persistedPacketPath = join(
    repoRoot,
    ".hatch",
    "external",
    "factory_supervisor",
    "runs",
    "r-remote",
    "packets",
    "remote_cli_runtime_crash",
    `${crashPacketItem.remediation_packet.packet_id}.json`,
  );
  assert.equal(existsSync(persistedPacketPath), true, "remote crash packet should persist before snapshot cleanup/escalation");
});

test("buildStateSnapshot emits HUMAN_BLOCKER_OPEN action items with latest human response context", () => {
  const humanBody = [
    "Machine-generated human blocker request.",
    "",
    "```json",
    JSON.stringify({
      schema_version: "human_blocker.v1",
      source_issue_number: 1484,
      goal_issue_number: 1478,
      blocker_kind: "owner_decision",
      exact_request: "Choose billing provider",
      why_blocked: "Repo does not contain an owner-approved billing choice",
      unblock_condition: "A provider is chosen",
      owner_hint: "Product owner",
      signature_hash: "sha256:test",
    }, null, 2),
    "```",
    "Human-Blocker-Signature: sha256:test",
  ].join("\n");

  const ghJsonFn = makeGhStub({
    human: [{ number: 2001, title: "[human] Choose billing provider for issue #1484", body: humanBody }],
    humanViews: {
      2001: {
        state: "OPEN",
        comments: [
          { body: "## Human Response\nStatus: satisfied\nDecision/Input: Use Stripe\nNotes: Sandbox first" },
        ],
      },
    },
  });

  const out = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn,
    recoverySweepFn: () => ({ stale_runs: [] }),
    nowMs: 1_700_000_000_000,
    runsDir: join(process.cwd(), ".hatch", "runs"),
  }));

  const item = (out.action_items || []).find((entry) => String(entry.problem || "").startsWith("HUMAN_BLOCKER_OPEN:"));
  assert.ok(item, "expected HUMAN_BLOCKER_OPEN action item");
  assert.equal(String(item?.diagnostics?.blocker_kind || ""), "owner_decision");
  assert.equal(String(item?.diagnostics?.response_status || ""), "satisfied");
  assert.match(String(item?.suggested_action || ""), /re-review human blocker/i);
  assert.equal(String(item?.remediation_packet?.packet_type || ""), "human_blocker_recheck");
});

test("buildStateSnapshot suppresses resolved merge-marker CLI crashes", () => {
  const ghJsonFn = makeGhStub();
  const recoverySweepFn = () => ({ stale_runs: [] });
  const scanCliCrashesFn = () => ([
    {
      run_id: "r-1",
      pipeline: "factories/mothership/workflows/wave-execution/wave_issue_execute.workflow-source.mjs",
      node: "execute_issue",
      crash_type: "merge_marker_in_executable",
      file_path: `${process.cwd()}/packages/factory-ops/src/cli.ts`,
      error_excerpt: "SyntaxError: Unexpected token '<<'",
    },
  ]);

  const out = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn,
    recoverySweepFn,
    scanCliCrashesFn,
    nowMs: 1_700_000_000_000,
    runsDir: join(process.cwd(), ".hatch", "runs"),
  }));

  const incident = (out.action_items || []).find((item) => String(item.problem || "").startsWith("CLI_RUNTIME_CRASH:"));
  assert.equal(Boolean(incident), false);
});

// Test removed: UNSCHEDULED_WAVE action items no longer emitted (waves replaced by goal-scoped sub-issues)

// Tests removed: STALLED_WAVE and UNSCHEDULED_WAVE action items no longer emitted (waves replaced by goal-scoped sub-issues)

test("buildStateSnapshot reports only truly unlabeled issues", () => {
  const ghJsonFn = makeGhStub({
    unlabeled: [
      { number: 100, title: "No labels", labels: [], createdAt: "2026-03-03T00:00:00Z" },
      { number: 101, title: "Has bug label", labels: [{ name: "bug" }], createdAt: "2026-03-03T00:00:00Z" },
      { number: 102, title: "Has goal+ready", labels: [{ name: "goal" }, { name: "ready" }], createdAt: "2026-03-03T00:00:00Z" },
    ],
  });
  const recoverySweepFn = () => ({ stale_runs: [] });

  const out = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn,
    recoverySweepFn,
    nowMs: 1_700_000_000_000,
    runsDir: join(process.cwd(), ".hatch", "runs"),
  }));

  const unlabeledItems = (out.action_items || []).filter((item) => String(item.problem || "") === "issue has no labels");
  assert.equal(unlabeledItems.length, 1);
  assert.equal(unlabeledItems[0].issue, 100);
});

test("buildStateSnapshot surfaces CONTRACT_DRIFT action items for completed wave runs with stale contract hash", () => {
  const ghJsonFn = makeGhStub();
  const recoverySweepFn = () => ({ stale_runs: [] });
  const runsDir = mkdtempSync(join(tmpdir(), "snapshot-drift-"));

  // Simulate a completed wave run that was spawned under a different contract hash
  mkdirSync(join(runsDir, "run-drift"), { recursive: true });
  writeFileSync(join(runsDir, "run-drift", "state.json"), JSON.stringify({
    runId: "run-drift",
    status: "completed",
    pipelineFile: "wave_execute.dot",
    context: {
      factory_contract_sha256: "stale_hash_from_spawn_time",
      wave_issue_number: "42",
      milestone: "goal-3-wave-1",
    },
    updatedAt: new Date().toISOString(),
  }));

  // Also add a non-wave run with a stale hash — should be ignored
  mkdirSync(join(runsDir, "run-goal"), { recursive: true });
  writeFileSync(join(runsDir, "run-goal", "state.json"), JSON.stringify({
    runId: "run-goal",
    status: "completed",
    pipelineFile: "goal_run.dot",
    context: { factory_contract_sha256: "stale_hash_from_spawn_time" },
    updatedAt: new Date().toISOString(),
  }));

  // Build a minimal factory root so computeFactoryContractHash returns a real hash
  const factoryRoot = join(runsDir, "..", "factory-root");
  mkdirSync(join(factoryRoot, "skills", "code_review"), { recursive: true });
  mkdirSync(join(factoryRoot, "graphs"), { recursive: true });
  writeFileSync(join(factoryRoot, "skills", "code_review", "SKILL.md"), "# Review\n");
  writeFileSync(join(factoryRoot, "graphs", "wave_execute.dot"), "digraph { a -> b; }");
  writeFileSync(join(factoryRoot, "roles.stylesheet"), "worker { model=\"gpt-5\" }");

  const out = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    factoryRoot,
    ghJsonFn,
    recoverySweepFn,
    nowMs: Date.now(),
    runsDir,
  }));

  const drift = (out.action_items || []).find((item) => String(item.type || "") === "contract_drift");
  assert.ok(drift, "expected contract_drift action item");
  assert.match(String(drift.problem || ""), /CONTRACT_DRIFT/);
  assert.match(String(drift.problem || ""), /#42/);
  assert.equal(drift.diagnostics.wave_issue_number, "42");
  assert.equal(drift.diagnostics.milestone, "goal-3-wave-1");
  assert.equal(drift.diagnostics.spawn_hash, "stale_hash_from_spawn_time");
  assert.ok(drift.diagnostics.current_hash, "must include current hash");
  assert.notEqual(drift.diagnostics.current_hash, "stale_hash_from_spawn_time");
  assert.equal(drift.remediation_packet.packet_type, "contract_drift_wave_cleanup");
  assert.ok(drift.suggested_action.length > 20, "must include descriptive suggested_action");
  // Goal run with stale hash should NOT produce a drift action item
  const goalDrift = (out.action_items || []).filter((item) =>
    String(item.type || "") === "contract_drift" && String(item.diagnostics?.pipeline || "").includes("goal"),
  );
  assert.equal(goalDrift.length, 0, "non-wave pipelines should not trigger drift detection");
});

test("buildStateSnapshot caps stale-bug action items to newest three", () => {
  const ghJsonFn = makeGhStub({
    bugs: [
      { number: 1, title: "bug-1", createdAt: "2023-11-14T20:13:20.000Z" },
      { number: 2, title: "bug-2", createdAt: "2023-11-14T21:13:20.000Z" },
      { number: 3, title: "bug-3", createdAt: "2023-11-14T22:13:20.000Z" },
      { number: 4, title: "bug-4", createdAt: "2023-11-14T23:13:20.000Z" },
      { number: 5, title: "bug-5", createdAt: "2023-11-15T00:13:20.000Z" },
    ],
  });
  const recoverySweepFn = () => ({ stale_runs: [] });

  const out = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn,
    recoverySweepFn,
    nowMs: 1_700_100_000_000,
    runsDir: join(process.cwd(), ".hatch", "runs"),
  }));

  const staleBugItems = (out.action_items || []).filter((item) => String(item.problem || "") === "open bug older than 1 hour — verify if still reproducible");
  assert.equal(staleBugItems.length, 3);
  assert.deepEqual(staleBugItems.map((item) => item.issue), [5, 4, 3]);
});

test("buildStateSnapshot uses a single unified fetch for all open issues", () => {
  let issueListCalls = 0;
  const out = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn: (args, fallback = []) => {
      const cmd = Array.isArray(args) ? args.join(" ") : "";
      if (cmd.includes("issue list") && cmd.includes("--state open") && cmd.includes("--limit 500")) {
        issueListCalls += 1;
        return [{ number: 2181, title: "Goal: Daily Lens", labels: [{ name: "goal" }] }];
      }
      if (cmd.includes("api graphql")) {
        return { data: { repository: {} } };
      }
      if (cmd.includes("/milestones?state=all&per_page=100")) return [];
      return fallback;
    },
    recoverySweepFn: () => ({ stale_runs: [] }),
    listGoalSubIssuesFn: () => [],
    scanCliCrashesFn: () => [],
    nowMs: 1_700_100_000_000,
  }));

  assert.ok(Array.isArray(out.action_items));
  assert.equal(issueListCalls, 1, "should make exactly 1 issue list call (unified fetch)");
});
