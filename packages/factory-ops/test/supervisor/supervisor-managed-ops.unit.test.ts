import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { evaluateManagedControlGate, evaluateManagedControlStateGate } from "../../src/commands/supervisor-managed-control-gate.ts";
import { classifyManagedLifecycleState } from "../../src/commands/supervisor-managed-health-classifier.ts";
import { classifyManagedFailure } from "../../src/commands/supervisor-managed-failure-classifier.ts";
import { classifySupervisorFailure } from "../../src/commands/supervisor-failure-classifier.ts";
import { loadManagedSupervisorContext } from "../../src/commands/supervisor-managed-load-context.ts";
import { buildManagedRunSummary } from "../../src/commands/supervisor-managed-summary.ts";
import { evaluateManagedActionItemGate } from "../../src/commands/supervisor-managed-action-item-gate.ts";
import { selectManagedIntakeIssue } from "../../src/commands/supervisor-managed-intake-selector.ts";
import { emitManagedRunSummary } from "../../src/commands/supervisor-managed-emit-run-summary.ts";
import { persistManagedLifecycleState } from "../../src/commands/supervisor-managed-persist-state.ts";

test("evaluateManagedControlGate maps pause/quarantine into paused gate", () => {
  assert.deepEqual(evaluateManagedControlGate({ stateAction: "pause", reason: "manual" }), {
    control_gate: "paused",
    control_state_action: "pause",
    control_state_reason: "manual",
    should_run: "false",
  });
  assert.deepEqual(evaluateManagedControlGate({ stateAction: "quarantine", reason: "safety" }), {
    control_gate: "paused",
    control_state_action: "quarantine",
    control_state_reason: "safety",
    should_run: "false",
  });
});

test("evaluateManagedControlGate maps draining into draining gate", () => {
  assert.deepEqual(evaluateManagedControlGate({ stateAction: "draining", reason: "shutdown" }), {
    control_gate: "draining",
    control_state_action: "draining",
    control_state_reason: "shutdown",
    should_run: "false",
  });
});

test("evaluateManagedControlStateGate reads active state action from control-state reader", () => {
  const out = evaluateManagedControlStateGate({
    factoryId: "brainstorm",
    readControlStateFn: () => ({
      reason: "manual pause",
      state_path: "/tmp/control-state.json",
      action_state: { pause: { active: true } },
    }),
  });

  assert.equal(out.control_gate, "paused");
  assert.equal(out.control_state_action, "pause");
  assert.equal(out.control_state_reason, "manual pause");
  assert.equal(out.should_run, "false");
  assert.equal(out.parse_error, "");
  assert.equal(out.state_path, "/tmp/control-state.json");
});

test("classifyManagedLifecycleState produces blocked/active/degraded/idle states", () => {
  assert.equal(classifyManagedLifecycleState({ controlGate: "paused" }).lifecycle_state, "paused");
  assert.equal(classifyManagedLifecycleState({ controlGate: "draining" }).lifecycle_state, "draining");
  assert.equal(classifyManagedLifecycleState({ hasOpenUpstreamBugs: "true" }).lifecycle_state, "blocked_platform");
  assert.equal(classifyManagedLifecycleState({ hasActionItems: "true" }).lifecycle_state, "blocked_local");
  assert.equal(classifyManagedLifecycleState({ hasSelectedWork: "true", hasDomainFailure: "true" }).lifecycle_state, "degraded");
  assert.equal(classifyManagedLifecycleState({ hasSelectedWork: "true", hasDomainFailure: "false" }).lifecycle_state, "active");
  assert.equal(classifyManagedLifecycleState({ hasSelectedWork: "false", hasDomainFailure: "false" }).lifecycle_state, "idle");
});

test("classifyManagedFailure distinguishes infrastructure/local/ambiguous", () => {
  assert.equal(
    classifyManagedFailure({ domainError: "managed-factory-bug gate failed" }).failure_classification,
    "infrastructure",
  );
  assert.equal(
    classifyManagedFailure({ domainError: "kind_missing_domain_graph" }).failure_classification,
    "local",
  );
  assert.equal(
    classifyManagedFailure({ domainError: "unexpected timeout in unknown subsystem" }).failure_classification,
    "ambiguous",
  );
  assert.equal(classifyManagedFailure({}).failure_classification, "none");
});

test("classifySupervisorFailure routes shared-graph crashes to platform without prompt input", () => {
  const out = classifySupervisorFailure({
    bugType: "factory-cli-runtime-crash",
    sourceRepo: "example-org/example-notes",
    controlPlaneRepo: "recallnet/astrochicken",
    evidence: {
      crash_type: "module_not_found",
      pipeline: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
      file_path: "packages/factory-ops/src/commands/supervisor-state-snapshot-actions.ts",
      node: "supervisor_state_snapshot",
    },
  });

  assert.equal(out.classification, "platform");
  assert.equal(out.crash_type, "module_not_found");
});

test("evaluateManagedActionItemGate reads action_items from snapshot", () => {
  const out = evaluateManagedActionItemGate({ snapshot: JSON.stringify({ action_items: [{ id: 1 }, { id: 2 }] }) });
  assert.equal(out.has_action_items, "true");
  assert.equal(out.action_item_count, 2);

  const empty = evaluateManagedActionItemGate({ snapshot: JSON.stringify({ action_items: [] }) });
  assert.equal(empty.has_action_items, "false");
  assert.equal(empty.action_item_count, 0);

  const b64 = Buffer.from(JSON.stringify({ action_items: [{ id: "a" }] }), "utf8").toString("base64");
  const fromB64 = evaluateManagedActionItemGate({ snapshotB64: b64 });
  assert.equal(fromB64.has_action_items, "true");
  assert.equal(fromB64.action_item_count, 1);
});

test("loadManagedSupervisorContext fails closed when kind/instance manifests mismatch", () => {
  const out = loadManagedSupervisorContext({
    factoryId: "brainstorm",
    kindPath: "/tmp/does-not-exist-kind.json",
    instancePath: "/tmp/does-not-exist-instance.json",
  });

  assert.equal(out.manifest_ok, "false");
  assert.match(String(out.manifest_error || ""), /missing_file/);
});

test("loadManagedSupervisorContext accepts config-only managed factory context without instance manifest", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "managed-load-context-"));
  const factoryRoot = join(sandbox, "factories", "example-trading");
  mkdirSync(factoryRoot, { recursive: true });
  writeFileSync(join(factoryRoot, "kind.json"), JSON.stringify({
    kind_id: "example-trading",
    schema_version: 1,
    managed: true,
    execution_mode: "code",
    shared_supervisor_shell: "packages/factory-runtime/workflows/managed-supervisor-shell/managed-supervisor-shell.workflow-source.mjs",
    domain_graph: "packages/factory-runtime/workflows/managed_software_delivery_domain/managed_software_delivery_domain.workflow-source.mjs",
    supported_destinations: ["platform_incidents"],
    required_labels: ["managed-factory-bug", "factory:example-trading"],
  }));

  const out = loadManagedSupervisorContext({
    factoryId: "example-trading",
    factoryRoot,
    kindPath: join(factoryRoot, "kind.json"),
    instancePath: join(sandbox, ".hatch", "instance.json"),
    kindId: "example-trading",
    instanceId: "example-trading",
    targetRepo: "example-org/example-trading",
    controlPlaneRepo: "recallnet/astrochicken",
    destinationsJson: JSON.stringify({
      platform_incidents: {
        repo: "recallnet/astrochicken",
        labels: ["managed-factory-bug", "factory:example-trading"],
      },
    }),
    trustDomain: "example-trading.local",
    trustRole: "example-trading.local.tool",
  });

  assert.equal(out.manifest_ok, "true");
  assert.equal(out.factory_id, "example-trading");
  assert.equal(out.kind_id, "example-trading");
  assert.equal(out.instance_id, "example-trading");
  assert.equal(out.target_repo, "example-org/example-trading");
  assert.equal(out.control_plane_repo, "recallnet/astrochicken");
  assert.deepEqual(JSON.parse(out.intake_json), {
    issue_selector: {
      labels: ["goal", "ready"],
    },
  });
  assert.deepEqual(JSON.parse(out.destinations_json), {
    platform_incidents: {
      repo: "recallnet/astrochicken",
      labels: ["managed-factory-bug", "factory:example-trading"],
    },
  });
});

test("loadManagedSupervisorContext backfills default goal intake when instance manifest omits intake", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "managed-load-context-existing-instance-"));
  const factoryRoot = join(sandbox, "factories", "example-trading");
  const hatchRoot = join(sandbox, ".hatch");
  mkdirSync(factoryRoot, { recursive: true });
  mkdirSync(hatchRoot, { recursive: true });
  writeFileSync(join(factoryRoot, "kind.json"), JSON.stringify({
    kind_id: "example-trading",
    schema_version: 1,
    managed: true,
    execution_mode: "code",
    shared_supervisor_shell: "packages/factory-runtime/workflows/managed-supervisor-shell/managed-supervisor-shell.workflow-source.mjs",
    domain_graph: "packages/factory-runtime/workflows/managed_software_delivery_domain/managed_software_delivery_domain.workflow-source.mjs",
    supported_destinations: ["platform_incidents"],
    required_labels: ["managed-factory-bug", "factory:example-trading"],
  }));
  writeFileSync(join(hatchRoot, "instance.json"), JSON.stringify({
    kind_id: "example-trading",
    instance_id: "example-trading",
    control_plane_repo: "recallnet/astrochicken",
    target_repo: {
      full_name: "example-org/example-trading",
    },
    destinations: {
      platform_incidents: {
        repo: "recallnet/astrochicken",
        labels: ["managed-factory-bug", "factory:example-trading"],
      },
    },
  }));

  const out = loadManagedSupervisorContext({
    factoryId: "example-trading",
    factoryRoot,
    kindPath: join(factoryRoot, "kind.json"),
    instancePath: join(hatchRoot, "instance.json"),
    kindId: "example-trading",
    instanceId: "example-trading",
    targetRepo: "example-org/example-trading",
    controlPlaneRepo: "recallnet/astrochicken",
    trustDomain: "example-trading.local",
    trustRole: "example-trading.local.tool",
  });

  assert.equal(out.manifest_ok, "true");
  assert.deepEqual(JSON.parse(out.intake_json), {
    issue_selector: {
      labels: ["goal", "ready"],
    },
  });
});

test("buildManagedRunSummary emits stable structured payload contract", () => {
  const summary = buildManagedRunSummary({
    factoryId: "brainstorm",
    instanceId: "fac_01TEST",
    kindId: "brainstorm",
    targetRepo: "example-org/brainstorm-lab",
    targetRepo: "example-org/brainstorm-lab",
    controlPlaneRepo: "recallnet/astrochicken",
    trustDomain: "brainstorm.local",
    trustRole: "brainstorm.local",
    lifecycleState: "active",
    healthState: "active",
    failureClassification: "none",
    controlGate: "run",
    controlStateAction: "none",
    hasOpenUpstreamBugs: "false",
    openUpstreamBugCount: "0",
    openUpstreamBugNumbers: "[]",
    hasActionItems: "false",
    actionItemCount: "0",
    hasIssue: "true",
    selectedIssueNumber: "1201",
    domainResult: JSON.stringify({ dispatched: true, issue: 1201 }),
    manifestOk: "true",
  });

  assert.equal(summary.schema_version, "managed_supervisor_run_summary/v1");
  assert.equal(summary.factory_id, "brainstorm");
  assert.equal(summary.instance_id, "fac_01TEST");
  assert.equal(summary.kind_id, "brainstorm");
  assert.equal(summary.context.target_repo, "example-org/brainstorm-lab");
  assert.equal(summary.lifecycle.state, "active");
  assert.equal(summary.failure.classification, "none");
  assert.equal(summary.blockers.upstream.has_open_upstream_bugs, false);
  assert.equal(summary.blockers.action_items.has_action_items, false);
  assert.equal(summary.intake.has_issue, true);
  assert.equal(summary.intake.selected_issue_number, 1201);
  assert.deepEqual(summary.domain_result, { dispatched: true, issue: 1201 });
  assert.equal(summary.telemetry.event_name, "factory.managed_supervisor.run_summary");
  assert.equal(summary.managed_snapshot.schema_version, "managed-factory-snapshot/v1");
  assert.equal(summary.managed_snapshot.unresolved_actions, 0);
  assert.equal(summary.managed_snapshot.queue_depth, 0);
  assert.equal(summary.managed_snapshot.oldest_work_age_seconds, 0);
  assert.deepEqual(summary.managed_snapshot.latest_incidents, []);
});

test("buildManagedRunSummary mirrors managed snapshot operational fields", () => {
  const summary = buildManagedRunSummary({
    lifecycleState: "blocked_local",
    failureClassification: "local",
    failureReason: "action_item_count=2",
    hasOpenUpstreamBugs: "false",
    openUpstreamBugCount: "0",
    openUpstreamBugNumbers: "[]",
    hasActionItems: "true",
    actionItemCount: "2",
    unresolvedActions: "4",
    queueDepth: "6",
    oldestWorkAgeSeconds: "90",
    latestIncidents: '[{"incident_fingerprint":"inc-2","severity":"error"}]',
  });

  assert.equal(summary.blockers.action_items.action_item_count, 2);
  assert.equal(summary.managed_snapshot.unresolved_actions, 4);
  assert.equal(summary.managed_snapshot.queue_depth, 6);
  assert.equal(summary.managed_snapshot.oldest_work_age_seconds, 90);
  assert.deepEqual(summary.managed_snapshot.latest_incidents, [{ incident_fingerprint: "inc-2", severity: "error" }]);
  assert.equal(summary.managed_snapshot.blockers.action_items.action_item_count, summary.blockers.action_items.action_item_count);
  assert.equal(summary.managed_snapshot.blockers.upstream.open_upstream_bug_count, summary.blockers.upstream.open_upstream_bug_count);
});

test("selectManagedIntakeIssue deterministically selects lowest-number open intake issue", () => {
  const out = selectManagedIntakeIssue({
    repo: "example-org/brainstorm-lab",
    intakeJson: JSON.stringify({ issue_selector: { labels: ["hatch:intake"] } }),
    ghJsonFn: () => ([
      { number: 54, title: "Later", body: "later", url: "https://example.test/54", labels: [{ name: "hatch:intake" }] },
      { number: 21, title: "First", body: "first", url: "https://example.test/21", labels: [{ name: "hatch:intake" }] },
    ]),
  });

  assert.equal(out.has_issue, "true");
  assert.equal(out.selected_issue_number, "21");
  assert.equal(out.parse_error, "");

  const intake = JSON.parse(out.intake_json);
  assert.equal(intake.target_repo, "example-org/brainstorm-lab");
  assert.deepEqual(intake.issue_selector?.labels, ["hatch:intake"]);
  assert.equal(intake.has_issue, true);
  assert.equal(intake.issue?.number, 21);
  assert.equal(intake.issue?.source_issue_id, "21");
  assert.deepEqual(intake.issue?.labels, ["hatch:intake"]);
});

test("selectManagedIntakeIssue fails closed when selector labels are missing", () => {
  const out = selectManagedIntakeIssue({
    repo: "example-org/brainstorm-lab",
    intakeJson: JSON.stringify({ issue_selector: { labels: [] } }),
    ghJsonFn: () => {
      throw new Error("should_not_call_gh_when_selector_invalid");
    },
  });

  assert.equal(out.has_issue, "false");
  assert.equal(out.parse_error, "missing_issue_selector_labels");
  const intake = JSON.parse(out.intake_json);
  assert.equal(intake.has_issue, false);
  assert.equal(intake.reason, "missing_issue_selector_labels");
});

test("emitManagedRunSummary returns sanitized mirrored summary payload", () => {
  const summary = emitManagedRunSummary({
    factoryId: "brainstorm",
    lifecycleState: "idle",
    healthState: "idle",
    failureClassification: "none",
    hasIssue: "false",
    openUpstreamBugNumbers: "[]",
    domainResult: JSON.stringify({ ok: true }),
  });
  assert.equal(summary.schema_version, "managed_supervisor_run_summary/v1");
  assert.equal(summary.factory_id, "brainstorm");
  assert.equal(summary.lifecycle.state, "idle");
  assert.equal("domain_result" in summary, false);
  assert.equal("event_name" in (summary.telemetry || {}), false);
});

test("persistManagedLifecycleState writes lifecycle snapshot through canonical control projection owner", () => {
  let recorded = null;
  const out = persistManagedLifecycleState({
    factoryId: "brainstorm",
    instanceId: "fac_01TEST",
    rootDir: "/tmp/brainstorm",
    lifecycleState: "blocked_platform",
    lifecycleReason: "open upstream blockers",
    failureClassification: "infrastructure",
    failureReason: "open_upstream_bugs=2",
    hasOpenUpstreamBugs: "true",
    openUpstreamBugCount: "2",
    openUpstreamBugNumbers: "[2116,2117]",
    hasActionItems: "true",
    actionItemCount: "3",
    queueDepth: "5",
    oldestWorkAgeSeconds: "120",
    latestIncidents: '[{"incident_fingerprint":"inc-1","severity":"warn"}]',
    actor: "managed_supervisor",
    writeLifecycleProjectionFn: (args) => {
      recorded = args;
      return {
        state_path: "/tmp/brainstorm/.hatch/factories/brainstorm/control-state.json",
        version: 4,
        lifecycle_state_snapshot: {
          schema_version: "managed-factory-snapshot/v1",
          lifecycle_state: "blocked_platform",
          lifecycle_reason: "open upstream blockers",
          lifecycle_failure_classification: "infrastructure",
          lifecycle_failure_reason: "open_upstream_bugs=2",
          lifecycle_updated_at: "2026-03-15T22:00:00.000Z",
          blockers: {
            upstream: {
              has_open_upstream_bugs: true,
              open_upstream_bug_count: 2,
              open_upstream_bug_numbers: [2116, 2117],
            },
            action_items: {
              has_action_items: true,
              action_item_count: 3,
            },
          },
          unresolved_actions: 3,
          queue_depth: 5,
          oldest_work_age_seconds: 120,
          latest_incidents: [{ incident_fingerprint: "inc-1", severity: "warn" }],
        },
      };
    },
  });

  assert.equal(recorded.factoryId, "brainstorm");
  assert.equal(recorded.rootDir, "/tmp/brainstorm");
  assert.equal(recorded.lifecycleState, "blocked_platform");
  assert.equal(recorded.lifecycleStateSnapshot.blockers.upstream.open_upstream_bug_count, 2);
  assert.equal(recorded.lifecycleStateSnapshot.blockers.action_items.action_item_count, 3);
  assert.equal(recorded.lifecycleStateSnapshot.unresolved_actions, 3);
  assert.equal(recorded.lifecycleStateSnapshot.queue_depth, 5);
  assert.equal(recorded.lifecycleStateSnapshot.oldest_work_age_seconds, 120);
  assert.deepEqual(recorded.lifecycleStateSnapshot.latest_incidents, [{ incident_fingerprint: "inc-1", severity: "warn" }]);
  assert.equal(out.ok, true);
  assert.equal(out.instance_id, "fac_01TEST");
  assert.equal(out.mirror_error, "");
  assert.match(out.mirror_path, /\.hatch\/fleet\/mirrors\/brainstorm\/fac_01TEST\/snapshot\.json$/);
  assert.equal(out.mirror_version, 4);
  assert.match(out.mirror_updated_at, /\d{4}-\d{2}-\d{2}T/);
  assert.equal(out.lifecycle_state, "blocked_platform");
  assert.equal(out.lifecycle_failure_classification, "infrastructure");
  assert.equal(out.queue_depth, 5);
  assert.equal(out.unresolved_actions, 3);
  assert.deepEqual(out.latest_incidents, [{ incident_fingerprint: "inc-1", severity: "warn" }]);
});

test("persistManagedLifecycleState reports mirror_error but succeeds when mirror write fails", () => {
  const out = persistManagedLifecycleState({
    factoryId: "brainstorm",
    instanceId: "fac_01TEST",
    lifecycleState: "idle",
    writeLifecycleProjectionFn: () => ({
      state_path: "/tmp/brainstorm/.hatch/factories/brainstorm/control-state.json",
      version: 6,
      lifecycle_state_snapshot: {
        schema_version: "managed-factory-snapshot/v1",
        lifecycle_state: "idle",
        lifecycle_reason: "",
        lifecycle_failure_classification: "none",
        lifecycle_failure_reason: "",
        lifecycle_updated_at: "2026-03-15T22:00:00.000Z",
        lifecycle_updated_by: "managed_supervisor",
        blockers: {
          upstream: {
            has_open_upstream_bugs: false,
            open_upstream_bug_count: 0,
            open_upstream_bug_numbers: [],
          },
          action_items: {
            has_action_items: false,
            action_item_count: 0,
          },
        },
        unresolved_actions: 0,
        queue_depth: 0,
        oldest_work_age_seconds: 0,
        latest_incidents: [],
      },
    }),
    writeManagedSnapshotMirrorFn: () => {
      const error = new Error("disk full");
      error.code = "mirror_write_failed";
      throw error;
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.state_version, 6);
  assert.equal(out.mirror_path, "");
  assert.equal(out.mirror_version, 0);
  assert.equal(out.mirror_updated_at, "");
  assert.equal(out.mirror_error, "mirror_write_failed");
});
