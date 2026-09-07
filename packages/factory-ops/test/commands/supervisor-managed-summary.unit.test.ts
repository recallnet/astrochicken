import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildManagedRunSummary } from "../../src/commands/supervisor-managed-summary.ts";

describe("buildManagedRunSummary", () => {
  // ── Schema and identity ──────────────────────────────────────────────

  it("schema_version is always managed_supervisor_run_summary/v1", () => {
    const result = buildManagedRunSummary({});
    assert.equal(result.schema_version, "managed_supervisor_run_summary/v1");
  });

  it("factory_id, instance_id, kind_id from args, trimmed", () => {
    const result = buildManagedRunSummary({
      factoryId: "  factory-1 ",
      instanceId: " inst-2  ",
      kindId: "  kind-3 ",
    });
    assert.equal(result.factory_id, "factory-1");
    assert.equal(result.instance_id, "inst-2");
    assert.equal(result.kind_id, "kind-3");
  });

  it("context contains target_repo, control_plane_repo, trust_domain, trust_role", () => {
    const result = buildManagedRunSummary({
      targetRepo: " owner/target ",
      controlPlaneRepo: " owner/cp ",
      trustDomain: " domain ",
      trustRole: " role ",
    });
    assert.deepEqual(result.context, {
      target_repo: "owner/target",
      control_plane_repo: "owner/cp",
      trust_domain: "domain",
      trust_role: "role",
    });
  });

  // ── Lifecycle ────────────────────────────────────────────────────────

  it("lifecycle.state defaults to idle when empty", () => {
    const result = buildManagedRunSummary({});
    assert.equal(result.lifecycle.state, "idle");

    const result2 = buildManagedRunSummary({ lifecycleState: "" });
    assert.equal(result2.lifecycle.state, "idle");
  });

  it("lifecycle.state reflects provided value", () => {
    const result = buildManagedRunSummary({ lifecycleState: "running" });
    assert.equal(result.lifecycle.state, "running");
  });

  it("lifecycle.health_state defaults to idle", () => {
    const result = buildManagedRunSummary({});
    assert.equal(result.lifecycle.health_state, "idle");

    const result2 = buildManagedRunSummary({ healthState: "healthy" });
    assert.equal(result2.lifecycle.health_state, "healthy");
  });

  it("lifecycle.control_gate defaults to run", () => {
    const result = buildManagedRunSummary({});
    assert.equal(result.lifecycle.control_gate, "run");

    const result2 = buildManagedRunSummary({ controlGate: "pause" });
    assert.equal(result2.lifecycle.control_gate, "pause");
  });

  it("lifecycle.control_state_action defaults to none", () => {
    const result = buildManagedRunSummary({});
    assert.equal(result.lifecycle.control_state_action, "none");

    const result2 = buildManagedRunSummary({ controlStateAction: "drain" });
    assert.equal(result2.lifecycle.control_state_action, "drain");
  });

  it("lifecycle.control_state_reason is passed through", () => {
    const result = buildManagedRunSummary({ controlStateReason: " reason here " });
    assert.equal(result.lifecycle.control_state_reason, "reason here");
  });

  // ── Intake ───────────────────────────────────────────────────────────

  it("intake.has_issue is true when hasIssue=true, false otherwise", () => {
    assert.equal(buildManagedRunSummary({ hasIssue: "true" }).intake.has_issue, true);
    assert.equal(buildManagedRunSummary({ hasIssue: "false" }).intake.has_issue, false);
    assert.equal(buildManagedRunSummary({ hasIssue: "" }).intake.has_issue, false);
    assert.equal(buildManagedRunSummary({}).intake.has_issue, false);
  });

  it("intake.selected_issue_number is parsed int when valid, null when empty/invalid", () => {
    assert.equal(
      buildManagedRunSummary({ selectedIssueNumber: "42" }).intake.selected_issue_number,
      42,
    );
    assert.equal(
      buildManagedRunSummary({ selectedIssueNumber: " 99 " }).intake.selected_issue_number,
      99,
    );
    assert.equal(
      buildManagedRunSummary({ selectedIssueNumber: "" }).intake.selected_issue_number,
      null,
    );
    assert.equal(
      buildManagedRunSummary({ selectedIssueNumber: "abc" }).intake.selected_issue_number,
      null,
    );
    assert.equal(
      buildManagedRunSummary({}).intake.selected_issue_number,
      null,
    );
  });

  it("intake.selected_issue_number is null for zero and negative", () => {
    assert.equal(
      buildManagedRunSummary({ selectedIssueNumber: "0" }).intake.selected_issue_number,
      null,
    );
    assert.equal(
      buildManagedRunSummary({ selectedIssueNumber: "-5" }).intake.selected_issue_number,
      null,
    );
  });

  // ── Manifest ─────────────────────────────────────────────────────────

  it("manifest.ok is true when manifestOk=true, false otherwise", () => {
    assert.equal(buildManagedRunSummary({ manifestOk: "true" }).manifest.ok, true);
    assert.equal(buildManagedRunSummary({ manifestOk: "false" }).manifest.ok, false);
    assert.equal(buildManagedRunSummary({}).manifest.ok, true); // default is "true"
  });

  it("manifest.error from manifestError", () => {
    const result = buildManagedRunSummary({ manifestError: " some error " });
    assert.equal(result.manifest.error, "some error");

    assert.equal(buildManagedRunSummary({}).manifest.error, "");
  });

  // ── Failure ──────────────────────────────────────────────────────────

  it("failure.classification defaults to none", () => {
    assert.equal(buildManagedRunSummary({}).failure.classification, "none");

    const result = buildManagedRunSummary({ failureClassification: "transient" });
    assert.equal(result.failure.classification, "transient");
  });

  it("failure.reason from failureReason", () => {
    const result = buildManagedRunSummary({ failureReason: " disk full " });
    assert.equal(result.failure.reason, "disk full");

    assert.equal(buildManagedRunSummary({}).failure.reason, "");
  });

  it("failure.parse_error from parseError", () => {
    const result = buildManagedRunSummary({ parseError: " bad json " });
    assert.equal(result.failure.parse_error, "bad json");

    assert.equal(buildManagedRunSummary({}).failure.parse_error, "");
  });

  // ── Domain result ────────────────────────────────────────────────────

  it("domain_result parsed from JSON string", () => {
    const result = buildManagedRunSummary({
      domainResult: JSON.stringify({ key: "value", count: 3 }),
    });
    assert.deepEqual(result.domain_result, { key: "value", count: 3 });
  });

  it("domain_result falls back to {} on invalid JSON", () => {
    assert.deepEqual(buildManagedRunSummary({ domainResult: "not json" }).domain_result, {});
  });

  it("domain_result falls back to {} on empty string", () => {
    assert.deepEqual(buildManagedRunSummary({ domainResult: "" }).domain_result, {});
    assert.deepEqual(buildManagedRunSummary({}).domain_result, {});
  });

  it("domain_result falls back to {} on array JSON", () => {
    assert.deepEqual(buildManagedRunSummary({ domainResult: "[1,2]" }).domain_result, {});
  });

  // ── Managed snapshot / blockers ──────────────────────────────────────

  it("managed_snapshot has schema_version managed-factory-snapshot/v1", () => {
    const result = buildManagedRunSummary({});
    assert.equal(result.managed_snapshot.schema_version, "managed-factory-snapshot/v1");
  });

  it("blockers.upstream.open_upstream_bug_numbers parsed from JSON array", () => {
    const result = buildManagedRunSummary({
      openUpstreamBugNumbers: "[10, 20, 30]",
    });
    assert.deepEqual(result.blockers.upstream.open_upstream_bug_numbers, [10, 20, 30]);
  });

  it("blockers.upstream.open_upstream_bug_numbers parsed from CSV", () => {
    const result = buildManagedRunSummary({
      openUpstreamBugNumbers: "10, 20, 30",
    });
    assert.deepEqual(result.blockers.upstream.open_upstream_bug_numbers, [10, 20, 30]);
  });

  it("blockers.upstream.open_upstream_bug_numbers is empty for empty input", () => {
    const result = buildManagedRunSummary({ openUpstreamBugNumbers: "" });
    assert.deepEqual(result.blockers.upstream.open_upstream_bug_numbers, []);
  });

  it("blockers.upstream.has_open_upstream_bugs from hasOpenUpstreamBugs", () => {
    assert.equal(
      buildManagedRunSummary({ hasOpenUpstreamBugs: "true" }).blockers.upstream.has_open_upstream_bugs,
      true,
    );
    assert.equal(
      buildManagedRunSummary({ hasOpenUpstreamBugs: "false" }).blockers.upstream.has_open_upstream_bugs,
      false,
    );
    assert.equal(
      buildManagedRunSummary({}).blockers.upstream.has_open_upstream_bugs,
      false,
    );
  });

  it("blockers.upstream.open_upstream_bug_count parsed from string", () => {
    const result = buildManagedRunSummary({ openUpstreamBugCount: "5" });
    assert.equal(result.blockers.upstream.open_upstream_bug_count, 5);

    assert.equal(buildManagedRunSummary({}).blockers.upstream.open_upstream_bug_count, 0);
  });

  it("blockers.action_items.action_item_count from actionItemCount", () => {
    const result = buildManagedRunSummary({ actionItemCount: "3" });
    assert.equal(result.blockers.action_items.action_item_count, 3);

    assert.equal(buildManagedRunSummary({}).blockers.action_items.action_item_count, 0);
  });

  it("blockers.action_items.has_action_items from hasActionItems", () => {
    assert.equal(
      buildManagedRunSummary({ hasActionItems: "true" }).blockers.action_items.has_action_items,
      true,
    );
    assert.equal(
      buildManagedRunSummary({}).blockers.action_items.has_action_items,
      false,
    );
  });

  it("managed_snapshot.queue_depth from queueDepth", () => {
    const result = buildManagedRunSummary({ queueDepth: "7" });
    assert.equal(result.managed_snapshot.queue_depth, 7);

    assert.equal(buildManagedRunSummary({}).managed_snapshot.queue_depth, 0);
  });

  it("managed_snapshot.oldest_work_age_seconds from oldestWorkAgeSeconds", () => {
    const result = buildManagedRunSummary({ oldestWorkAgeSeconds: "120" });
    assert.equal(result.managed_snapshot.oldest_work_age_seconds, 120);

    assert.equal(buildManagedRunSummary({}).managed_snapshot.oldest_work_age_seconds, 0);
  });

  it("managed_snapshot.latest_incidents parsed from JSON", () => {
    const incidents = [
      { incident_fingerprint: "fp1", severity: "high" },
      { incident_fingerprint: "fp2", severity: "low" },
    ];
    const result = buildManagedRunSummary({
      latestIncidents: JSON.stringify(incidents),
    });
    assert.deepEqual(result.managed_snapshot.latest_incidents, incidents);
  });

  it("managed_snapshot.latest_incidents returns [] for invalid input", () => {
    assert.deepEqual(buildManagedRunSummary({ latestIncidents: "bad" }).managed_snapshot.latest_incidents, []);
    assert.deepEqual(buildManagedRunSummary({}).managed_snapshot.latest_incidents, []);
  });

  it("managed_snapshot.latest_incidents filters entries missing fingerprint or severity", () => {
    const incidents = [
      { incident_fingerprint: "fp1", severity: "high" },
      { incident_fingerprint: "", severity: "low" },
      { severity: "med" },
      { incident_fingerprint: "fp3" },
      null,
    ];
    const result = buildManagedRunSummary({
      latestIncidents: JSON.stringify(incidents),
    });
    assert.deepEqual(result.managed_snapshot.latest_incidents, [
      { incident_fingerprint: "fp1", severity: "high" },
    ]);
  });

  it("managed_snapshot.unresolved_actions falls back to action_item_count", () => {
    const result = buildManagedRunSummary({ actionItemCount: "5" });
    assert.equal(result.managed_snapshot.unresolved_actions, 5);
  });

  it("managed_snapshot.unresolved_actions uses explicit value when provided", () => {
    const result = buildManagedRunSummary({
      actionItemCount: "5",
      unresolvedActions: "2",
    });
    assert.equal(result.managed_snapshot.unresolved_actions, 2);
  });

  // ── Telemetry ────────────────────────────────────────────────────────

  it("telemetry event_name is factory.managed_supervisor.run_summary", () => {
    const result = buildManagedRunSummary({});
    assert.equal(result.telemetry.event_name, "factory.managed_supervisor.run_summary");
  });

  it("telemetry reflects lifecycle_state and failure_classification", () => {
    const result = buildManagedRunSummary({
      lifecycleState: "failed",
      failureClassification: "permanent",
    });
    assert.equal(result.telemetry.lifecycle_state, "failed");
    assert.equal(result.telemetry.failure_classification, "permanent");
  });

  // ── Defaults (call with no args) ────────────────────────────────────

  it("all defaults produce a valid idle summary", () => {
    const result = buildManagedRunSummary({});
    assert.equal(result.schema_version, "managed_supervisor_run_summary/v1");
    assert.equal(result.factory_id, "");
    assert.equal(result.instance_id, "");
    assert.equal(result.kind_id, "");
    assert.deepEqual(result.context, {
      target_repo: "",
      control_plane_repo: "",
      trust_domain: "",
      trust_role: "",
    });
    assert.equal(result.lifecycle.state, "idle");
    assert.equal(result.lifecycle.health_state, "idle");
    assert.equal(result.lifecycle.control_gate, "run");
    assert.equal(result.lifecycle.control_state_action, "none");
    assert.equal(result.lifecycle.control_state_reason, "");
    assert.equal(result.intake.has_issue, false);
    assert.equal(result.intake.selected_issue_number, null);
    assert.equal(result.manifest.ok, true);
    assert.equal(result.manifest.error, "");
    assert.equal(result.failure.classification, "none");
    assert.equal(result.failure.reason, "");
    assert.equal(result.failure.parse_error, "");
    assert.deepEqual(result.domain_result, {});
    assert.equal(result.managed_snapshot.schema_version, "managed-factory-snapshot/v1");
    assert.equal(result.managed_snapshot.lifecycle_state, "idle");
    assert.equal(result.managed_snapshot.lifecycle_failure_classification, "none");
    assert.equal(result.managed_snapshot.queue_depth, 0);
    assert.equal(result.managed_snapshot.oldest_work_age_seconds, 0);
    assert.deepEqual(result.managed_snapshot.latest_incidents, []);
    assert.equal(result.blockers.upstream.has_open_upstream_bugs, false);
    assert.equal(result.blockers.upstream.open_upstream_bug_count, 0);
    assert.deepEqual(result.blockers.upstream.open_upstream_bug_numbers, []);
    assert.equal(result.blockers.action_items.has_action_items, false);
    assert.equal(result.blockers.action_items.action_item_count, 0);
    assert.equal(result.telemetry.event_name, "factory.managed_supervisor.run_summary");
    assert.equal(result.telemetry.lifecycle_state, "idle");
    assert.equal(result.telemetry.failure_classification, "none");
  });

  it("calling with undefined args also produces valid idle summary", () => {
    const result = buildManagedRunSummary();
    assert.equal(result.schema_version, "managed_supervisor_run_summary/v1");
    assert.equal(result.lifecycle.state, "idle");
  });
});
