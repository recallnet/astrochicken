import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  factoryFleetBootstrapSnapshot,
  readFactoryRegistry,
  classifyFleetFactoryHealth,
  factoryFleetStatus,
  formatFleetStatusHuman,
} from "../../src/commands/factory-fleet-status.ts";
import { collectFactoryOutcomes } from "../../src/commands/factory-outcomes.ts";
import { factoryActiveSummary } from "../../src/lib/factory-active-summary.ts";
import { factoryStatus as canonicalFactoryStatus } from "../../src/lib/factory-status-canonical.ts";
import { inferFactoryRootFromRegistryEntry } from "../../src/lib/factory-status-collector.ts";
import {
  buildFactoryFleetProjection,
  collectFactoryRow,
  collectFactoryRowsSequential,
  collectFactoryRowsParallel,
  createDefaultFleetRowDeps,
} from "../../src/lib/factory-fleet-projection-support.ts";
import {
  legacyFixtureFactoryStatus as lowLevelFactoryStatus,
  legacyFixtureFactoryActiveSummary as lowLevelFactoryActiveSummary,
} from "../../src/lib/factory-status-support.ts";
import { tickStatus as lowLevelTickStatus } from "../../src/commands/factory-tick-status.ts";

test("readFactoryRegistry accepts new instances[] schema entries and normalizes target_repo identity", () => {
  const root = mkdtempSync(join(tmpdir(), "fleet-registry-instances-"));
  const registryPath = join(root, "factory-registry.json");
  writeFileSync(registryPath, JSON.stringify({
    schema: "hatch.factory.registry.v1",
    instances: [
      {
        instance_id: "fac_01JQ7M8JABC",
        kind_id: "brainstorm",
        target_repo: "example-org/brainstorm-lab",
        status: "active",
        assigned_host_id: "host_devrel_mac_01",
      },
    ],
  }, null, 2));

  const parsed = readFactoryRegistry({ registryPath, cwd: root });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.factories.length, 1);
  assert.equal(parsed.factories[0].target_repo, "example-org/brainstorm-lab");
});

test("readFactoryRegistry returns deterministic reasons for missing/malformed/schema failures", () => {
  const root = mkdtempSync(join(tmpdir(), "fleet-registry-"));

  const missingPath = "missing-factory-registry.json";
  const missing = readFactoryRegistry({ registryPath: missingPath, cwd: root });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "registry_missing");

  writeFileSync(join(root, missingPath), "{broken");
  const malformed = readFactoryRegistry({ registryPath: missingPath, cwd: root });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.reason, "registry_malformed_json");

  writeFileSync(join(root, missingPath), JSON.stringify({ schema: "bad", factories: [] }, null, 2));
  const invalidSchema = readFactoryRegistry({ registryPath: missingPath, cwd: root });
  assert.equal(invalidSchema.ok, false);
  assert.equal(invalidSchema.reason, "registry_invalid_schema");
});

test("readFactoryRegistry default registry includes mothership, brainstorm, and example-trading entries", () => {
  const registry = readFactoryRegistry({ registryPath: "factory-registry.json", cwd: process.cwd() });

  assert.equal(registry.ok, true);
  const rows = registry.factories || [];
  const ids = rows.map((row) => String(row.factory_id || "")).sort();
  assert.ok(ids.includes("mothership"), "registry must include mothership");
  assert.ok(ids.includes("brainstorm"), "registry must include brainstorm");
  assert.ok(ids.includes("example-trading"), "registry must include example-trading");

  const brainstorm = rows.find((row) => row.factory_id === "brainstorm");
  assert.equal(brainstorm?.target_repo, "example-org/example-notes");
  const replayLab = rows.find((row) => row.factory_id === "example-trading");
  assert.equal(replayLab?.target_repo, "example-org/example-trading");
});

test("factoryFleetBootstrapSnapshot returns shallow registry-backed rows without deep status hydration", () => {
  const registry = {
    ok: true,
    registry_path: "/tmp/factory-registry.json",
    factories: [
      {
        factory_id: "example-trading",
        kind_id: "managed_delivery",
        target_repo: "example-org/example-trading",
        control_plane_repo: "recallnet/astrochicken",
        graphs: [{ id: "tick", path: "factories/example-trading/graphs/factory_supervisor_tick.dot" }],
        daemon_status: { status: "running" },
      },
    ],
  };

  const snapshot = factoryFleetBootstrapSnapshot({
    context: { control_plane_repo: "recallnet/astrochicken" },
    readFactoryRegistryFn: () => registry,
  });

  assert.equal(snapshot.factories.length, 1);
  assert.equal(snapshot.factories[0].factory_id, "example-trading");
  assert.equal(snapshot.factories[0].target_repo, "example-org/example-trading");
  assert.equal(snapshot.factories[0].health, "idle");
  assert.equal(snapshot.factories[0].bootstrap_loading, true);
  assert.match(String(snapshot.factories[0].active_work_summary), /Loading live factory state/);
  assert.equal(snapshot.factories[0].daemon_health.running, true);
  assert.equal(snapshot.fleet_totals.total_factories, 1);
  assert.deepEqual(snapshot.warnings, ["fleet_bootstrap_snapshot"]);
});

test("inferFactoryRootFromRegistryEntry prefers canonical factories/<id> roots over capability graph paths", () => {
  assert.equal(inferFactoryRootFromRegistryEntry({
    factory_id: "mothership",
    graphs: [
      { id: "goal_queue", path: "packages/capability-goal-decomposition/workflows/goal_queue/goal_queue.workflow-source.mjs" },
      { id: "wave_execute", path: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs" },
    ],
  }), "factories/mothership");
});

test("classifyFleetFactoryHealth priority is deterministic", () => {
  assert.equal(classifyFleetFactoryHealth({
    errors: ["boom"],
    daemon_health: { status: "running", running: true },
    blocked_reason: "blocked",
    release_state: "blocked",
    active_waves: ["wave"],
    active_issues: [1],
  }), "unhealthy", "errors win first");

  assert.equal(classifyFleetFactoryHealth({
    errors: [],
    daemon_health: { status: "stopped", running: false },
    blocked_reason: "blocked",
    release_state: "blocked",
    active_waves: ["wave"],
    active_issues: [1],
  }), "healthy", "canonical work stays healthy even when host side-channel lags");

  assert.equal(classifyFleetFactoryHealth({
    errors: [],
    daemon_health: { status: "running", running: true },
    managed_state: { health_classification: "operator_paused" },
    blocked_reason: "operator pause",
    release_state: "ready",
    active_waves: [],
    active_issues: [],
  }), "blocked", "operator pause maps to blocked");

  assert.equal(classifyFleetFactoryHealth({
    errors: [],
    daemon_health: { status: "running", running: true },
    managed_state: { health_classification: "locally_unhealthy" },
    blocked_reason: "",
    release_state: "ready",
    active_waves: ["wave"],
    active_issues: [99],
  }), "unhealthy", "managed locally_unhealthy overrides active work");

  assert.equal(classifyFleetFactoryHealth({
    errors: [],
    daemon_health: { status: "running", running: true },
    blocked_reason: "release gate",
    release_state: "blocked",
    active_waves: [],
    active_issues: [],
  }), "blocked", "blocked beats idle");

  assert.equal(classifyFleetFactoryHealth({
    errors: [],
    daemon_health: { status: "running", running: true },
    managed_state: { health_classification: "control_plane_blocked" },
    blocked_reason: "release targeting degraded",
    release_state: "blocked",
    active_waves: ["wave"],
    active_issues: [77],
  }), "healthy", "active work beats background control-plane degradation");

  assert.equal(classifyFleetFactoryHealth({
    errors: [],
    daemon_health: { status: "running", running: true },
    blocked_reason: "",
    release_state: "upgrading",
    active_waves: ["wave"],
    active_issues: [2],
  }), "upgrading");

  assert.equal(classifyFleetFactoryHealth({
    errors: [],
    daemon_health: { status: "running", running: true },
    blocked_reason: "",
    release_state: "ready",
    active_waves: [],
    active_issues: [],
  }), "idle");

  assert.equal(classifyFleetFactoryHealth({
    errors: [],
    daemon_health: { status: "running", running: true },
    blocked_reason: "",
    release_state: "ready",
    active_waves: ["wave"],
    active_issues: [3],
  }), "healthy");
});

test("classifyFleetFactoryHealth does not let daemon status override canonical idle posture", () => {
  assert.equal(classifyFleetFactoryHealth({
    errors: [],
    daemon_health: { status: "stopped", running: false },
    blocked_reason: "",
    release_state: "ready",
    active_waves: [],
    active_issues: [],
    managed_state: { health_classification: "healthy" },
  }), "idle");
});

test("factoryFleetStatus returns contract with fleet_totals, warnings, and per-factory rows", async () => {
  const registry = {
    ok: true,
    registry_path: "/tmp/factory-registry.json",
    factories: [
      { factory_id: "alpha", kind_id: "brainstorm", target_repo: "acme/alpha", graphs: [], daemon_status: { status: "running" } },
      { factory_id: "beta", kind_id: "brainstorm", target_repo: "acme/beta", graphs: [], daemon_status: { status: "running" } },
      { factory_id: "gamma", kind_id: "brainstorm", target_repo: "acme/gamma", graphs: [], daemon_status: { status: "running" } },
      { factory_id: "delta", kind_id: "brainstorm", target_repo: "acme/delta", graphs: [], daemon_status: { status: "running" } },
      { factory_id: "epsilon", kind_id: "brainstorm", target_repo: "acme/epsilon", graphs: [], daemon_status: { status: "running" } },
    ],
  };

  const report = await buildFactoryFleetProjection({
    context: { control_plane_repo: "recallnet/astrochicken" },
    lookbackHours: 24,
    readFactoryRegistryFn: () => registry,
    resolveFactoryContextFn: ({ factoryId, targetRepo }) => {
      if (factoryId === "epsilon") throw new Error("resolver failure");
      return {
        factory_id: factoryId,
        target_repo: targetRepo,
        control_plane_repo: "recallnet/astrochicken",
        factory_root: `/tmp/${factoryId}`,
        runs_dir: `/tmp/runs/${factoryId}`,
      };
    },
    factoryStatusFn: ({ context }) => {
      const id = context.factory_id;
      if (id === "alpha") {
        return {
          active: [{ issue: "10" }],
          blocked_control_plane: [],
          control_plane: { resume_reason: "ready_to_resume" },
          managed_state: { state_action: "none", reason: "", retry_target: "", health_classification: "healthy" },
        };
      }
      if (id === "beta") {
        return {
          active: [{ issue: "20" }],
          blocked_control_plane: [{ milestone: "wave-b", issue_number: 20, linked_goal_number: 9020, unblockCondition: "await gate" }],
          control_plane: { resume_reason: "release_rollout_blocked", resume_when: "await gate" },
          managed_state: {
            state_action: "quarantine",
            reason: "cooldown active",
            retry_target: "",
            health_classification: "operator_quarantined",
          },
        };
      }
      if (id === "gamma") {
        return {
          active: [{ issue: "30" }],
          blocked_control_plane: [],
          control_plane: { resume_reason: "release_not_promoted_to_general" },
          managed_state: { state_action: "none", reason: "", retry_target: "", health_classification: "control_plane_blocked" },
        };
      }
      return {
        active: [],
        blocked_control_plane: [],
        control_plane: { resume_reason: "ready_to_resume" },
        managed_state: { state_action: "none", reason: "", retry_target: "", health_classification: "healthy" },
      };
    },
    factoryActiveSummaryFn: ({ context }) => {
      const id = context.factory_id;
      if (id === "alpha") return { waves: [{ milestone_title: "goal-1-wave-1", current_issue_number: 10 }], non_wave_active: [] };
      if (id === "beta") return { waves: [{ milestone_title: "goal-2-wave-1", current_issue_number: 20 }], non_wave_active: [] };
      if (id === "gamma") return { waves: [{ milestone_title: "goal-3-wave-1", current_issue_number: 30 }], non_wave_active: [] };
      return { waves: [], non_wave_active: [] };
    },
    tickStatusFn: ({ context }) => ({ ticks: [{ stage: "wave_execute", stageLabel: `${context.factory_id}-stage` }] }),
    hostHealthFn: ({ factoryId }) => {
      if (factoryId === "delta") return { status: "stopped", running: false, pid: 0, runCount: 0 };
      return { status: "running", running: true, pid: 123, runCount: 1 };
    },
    hostVersionFn: ({ factoryId }) => ({ version: factoryId === "gamma" ? "v1.0.1" : "v1.0.0" }),
    collectFactoryOutcomesFn: ({ repo }) => ({
      repo,
      merged_prs: 1,
      closed_features: 2,
      closed_bugs: 0,
      merge_commits_main: 3,
    }),
    factoryReleaseTargetingStatusFn: () => ({
      factories: [
        {
          factory_id: "alpha",
          rollout_channel: "stable",
          rollout_status: "ready",
          gate_reason: "ready_to_resume",
          upgrade_verification_outcome: "passed",
          release_identity: { release_id: "v1.0.0", release_tag: "v1.0.0", release_sha: "sha-100" },
          required_factory_release: "1.0.0",
          selected_for_canary: false,
          gate_allowed: true,
          resume_blocked: false,
        },
        {
          factory_id: "beta",
          rollout_channel: "stable",
          rollout_status: "blocked",
          gate_reason: "release_rollout_blocked",
          upgrade_verification_outcome: "failed",
          release_identity: { release_id: "v1.0.0", release_tag: "v1.0.0", release_sha: "sha-100" },
          required_factory_release: "1.0.0",
          selected_for_canary: false,
          gate_allowed: false,
          resume_blocked: true,
        },
        {
          factory_id: "gamma",
          rollout_channel: "stable",
          rollout_status: "lagging",
          gate_reason: "factory_release_below_required",
          upgrade_verification_outcome: "failed",
          release_identity: { release_id: "v1.0.0", release_tag: "v1.0.0", release_sha: "sha-100" },
          required_factory_release: "1.0.0",
          selected_for_canary: false,
          gate_allowed: false,
          resume_blocked: false,
        },
      ],
      warnings: [],
    }),
  });

  assert.equal(typeof report.generated_at, "string");
  assert.equal(report.fleet_totals.total_factories, 5);
  assert.equal(typeof report.kpis, "object");
  assert.equal(typeof report.kpis.window_hours, "number");
  assert.equal(report.kpis.window_hours, 24);
  assert.equal(report.kpis.factories_reporting, 5);
  assert.equal(report.kpis.daemons_running, 4);
  assert.equal(report.kpis.last_tick_known, 0);
  assert.equal(report.kpis.closed_goals, 0);
  assert.equal(report.kpis.closed_features, 10);
  assert.equal(report.kpis.closed_bugs, 0);
  assert.equal(report.kpis.merge_commits_main, 15);
  assert.equal(report.kpis.attention_factories, 5);
  assert.ok(Array.isArray(report.warnings));
  assert.ok(Array.isArray(report.factories));
  assert.deepEqual(report.factories.map((row) => row.factory_id), ["alpha", "beta", "delta", "epsilon", "gamma"]);

  const alpha = report.factories.find((row) => row.factory_id === "alpha");
  assert.equal(alpha.health, "healthy");
  assert.equal(alpha.runtime_version, "v1.0.0");
  assert.equal(alpha.rollout_channel, "stable");
  assert.equal(alpha.rollout_status, "ready");
  assert.equal(alpha.kind_version, "brainstorm");
  assert.equal(alpha.drift_state, "ready");
  const beta = report.factories.find((row) => row.factory_id === "beta");
  assert.equal(beta.health, "blocked");
  assert.equal(beta.drift_state, "blocked");
  assert.match(String(beta.blocked_reason || ""), /cooldown active/);
  assert.equal(beta.managed_state.health_classification, "operator_quarantined");
  assert.equal(Array.isArray(beta.blocked_control_plane), true);
  assert.equal(beta.blocked_control_plane[0].linked_goal_number, 9020);
  const gamma = report.factories.find((row) => row.factory_id === "gamma");
  assert.equal(gamma.health, "upgrading");
  assert.equal(gamma.drift_state, "lagging");
  assert.equal(gamma.managed_state.health_classification, "control_plane_blocked");
  const delta = report.factories.find((row) => row.factory_id === "delta");
  assert.equal(delta.health, "idle");
  const epsilon = report.factories.find((row) => row.factory_id === "epsilon");
  assert.equal(epsilon.health, "unhealthy");
  assert.equal(epsilon.drift_state, "unknown");
  assert.ok(epsilon.errors.length > 0);

  assert.equal(report.fleet_totals.drift_ready, 1);
  assert.equal(report.fleet_totals.drift_blocked, 1);
  assert.equal(report.fleet_totals.drift_lagging, 1);
  assert.equal(report.fleet_totals.drift_unknown, 2);

  for (const row of report.factories) {
    assert.ok(Object.hasOwn(row, "factory_id"));
    assert.ok(Object.hasOwn(row, "target_repo"));
    assert.ok(Object.hasOwn(row, "control_plane_repo"));
    assert.ok(Object.hasOwn(row, "version"));
    assert.ok(Object.hasOwn(row, "runtime_version"));
    assert.ok(Object.hasOwn(row, "runtime_version_source"));
    assert.ok(Object.hasOwn(row, "kind_version"));
    assert.ok(Object.hasOwn(row, "release_state"));
    assert.ok(Object.hasOwn(row, "rollout_channel"));
    assert.ok(Object.hasOwn(row, "rollout_status"));
    assert.ok(Object.hasOwn(row, "upgrade_verification_outcome"));
    assert.ok(Object.hasOwn(row, "gate_reason"));
    assert.ok(Object.hasOwn(row, "drift_state"));
    assert.ok(Object.hasOwn(row, "blocked_reason"));
    assert.ok(Object.hasOwn(row, "managed_state"));
    assert.ok(Object.hasOwn(row, "active_waves"));
    assert.ok(Object.hasOwn(row, "active_issues"));
    assert.ok(Object.hasOwn(row, "active_work_summary"));
    assert.ok(Object.hasOwn(row, "recent_host_activity"));
    assert.ok(Object.hasOwn(row, "recent_outcomes"));
    assert.ok(Object.hasOwn(row, "daemon_health"));
    assert.ok(Object.hasOwn(row, "health"));
    assert.ok(Object.hasOwn(row, "errors"));
  }
});

test("factoryFleetStatus degrades when registry is missing", async () => {
  const report = await buildFactoryFleetProjection({
    readFactoryRegistryFn: () => ({
      ok: false,
      reason: "registry_missing",
      registry_path: "/tmp/missing-registry.json",
      factories: [],
      error: "registry file not found",
    }),
    factoryReleaseTargetingStatusFn: () => ({ factories: [], warnings: [] }),
  });

  assert.equal(report.fleet_totals.total_factories, 0);
  assert.equal(report.factories.length, 0);
  assert.ok(report.warnings.some((entry) => entry.includes("registry_missing")));
});

test("factoryFleetStatus marks malformed registry entries unhealthy with warnings", async () => {
  const report = await buildFactoryFleetProjection({
    readFactoryRegistryFn: () => ({
      ok: true,
      reason: "ok",
      registry_path: "/tmp/factory-registry.json",
      factories: [
        {
          factory_id: "",
          target_repo: "acme/malformed",
          graphs: [],
          daemon_status: { status: "running" },
          registry_entry_index: 0,
          registry_validation_errors: ["missing_factory_id"],
        },
        {
          factory_id: "good-factory",
          target_repo: "acme/good",
          graphs: [],
          daemon_status: { status: "running" },
          registry_entry_index: 1,
          registry_validation_errors: [],
        },
      ],
      error: "",
    }),
    resolveFactoryContextFn: ({ factoryId, targetRepo }) => ({
      factory_id: factoryId,
      target_repo: targetRepo,
      control_plane_repo: "recallnet/astrochicken",
      factory_root: `/tmp/${factoryId}`,
      runs_dir: `/tmp/runs/${factoryId}`,
    }),
    factoryStatusFn: () => ({ active: [], blocked_control_plane: [], control_plane: { resume_reason: "ready_to_resume" } }),
    factoryActiveSummaryFn: () => ({ waves: [], non_wave_active: [] }),
    tickStatusFn: () => ({ ticks: [{ stageLabel: "Idle" }] }),
    hostHealthFn: () => ({ status: "running", running: true, pid: 123, runCount: 1 }),
    hostVersionFn: () => ({ version: "v1.0.0" }),
    collectFactoryOutcomesFn: () => ({ merged_prs: 0, closed_features: 0, closed_bugs: 0, merge_commits_main: 0 }),
    factoryReleaseTargetingStatusFn: () => ({ factories: [], warnings: [] }),
  });

  const malformed = report.factories.find((row) => row.factory_id === "malformed-registry-entry-1");
  const good = report.factories.find((row) => row.factory_id === "good-factory");
  assert.ok(malformed);
  assert.ok(good);
  assert.equal(malformed.health, "unhealthy");
  assert.ok(malformed.errors.some((entry) => entry.includes("malformed_registry_entry:missing_factory_id")));
  assert.ok(report.warnings.some((entry) => entry.includes("malformed-registry-entry-1:malformed_registry_entry:missing_factory_id")));
});

test("factoryFleetStatus propagates per-factory fetch throw warnings without aborting fleet", async () => {
  const report = await buildFactoryFleetProjection({
    readFactoryRegistryFn: () => ({
      ok: true,
      reason: "ok",
      registry_path: "/tmp/factory-registry.json",
      factories: [
        { factory_id: "alpha", target_repo: "acme/alpha", graphs: [], daemon_status: { status: "running" } },
        { factory_id: "beta", target_repo: "acme/beta", graphs: [], daemon_status: { status: "running" } },
      ],
      error: "",
    }),
    resolveFactoryContextFn: ({ factoryId, targetRepo }) => ({
      factory_id: factoryId,
      target_repo: targetRepo,
      control_plane_repo: "recallnet/astrochicken",
      factory_root: `/tmp/${factoryId}`,
      runs_dir: `/tmp/runs/${factoryId}`,
    }),
    factoryStatusFn: ({ context }) => {
      if (context.factory_id === "alpha") throw new Error("status boom");
      return { active: [{ issue: "201" }], blocked_control_plane: [], control_plane: { resume_reason: "ready_to_resume" } };
    },
    factoryActiveSummaryFn: ({ context }) => {
      if (context.factory_id === "alpha") throw new Error("active boom");
      return { waves: [{ milestone_title: "goal-201-wave-1", current_issue_number: 201 }], non_wave_active: [] };
    },
    tickStatusFn: ({ context }) => {
      if (context.factory_id === "alpha") throw new Error("tick boom");
      return { ticks: [{ stageLabel: "Executing wave" }] };
    },
    hostHealthFn: () => ({ status: "running", running: true, pid: 123, runCount: 1 }),
    hostVersionFn: () => ({ version: "v1.0.0" }),
    collectFactoryOutcomesFn: ({ repo }) => {
      if (repo === "acme/alpha") throw new Error("outcomes boom");
      return { merged_prs: 1, closed_features: 1, closed_bugs: 0, merge_commits_main: 1 };
    },
    factoryReleaseTargetingStatusFn: () => ({ factories: [], warnings: [] }),
  });

  const alpha = report.factories.find((row) => row.factory_id === "alpha");
  const beta = report.factories.find((row) => row.factory_id === "beta");
  assert.ok(alpha);
  assert.ok(beta);
  assert.equal(alpha.health, "unhealthy");
  assert.notEqual(beta.health, "unhealthy");
  assert.ok(report.warnings.some((entry) => entry.includes("alpha:factory_status_failed:status boom")));
  assert.ok(report.warnings.some((entry) => entry.includes("alpha:active_summary_failed:active boom")));
  assert.ok(report.warnings.some((entry) => entry.includes("alpha:tick_status_failed:tick boom")));
  assert.ok(report.warnings.some((entry) => entry.includes("alpha:outcomes_degraded:outcomes boom")));
});

test("factoryFleetStatus uses resolved host-scoped daemon paths instead of repo-local .hatch/hosts", async () => {
  const originalHostBaseDir = process.env.HATCH_HOST_BASE_DIR;
  const hostBaseDir = mkdtempSync(join(tmpdir(), "fleet-host-base-"));
  process.env.HATCH_HOST_BASE_DIR = hostBaseDir;
  try {
    let hostHealthCall = null;
    const report = await buildFactoryFleetProjection({
      readFactoryRegistryFn: () => ({
        ok: true,
        reason: "ok",
        registry_path: "/tmp/factory-registry.json",
        factories: [
          { factory_id: "brainstorm", target_repo: "example-org/example-notes", graphs: [], daemon_status: { status: "running" } },
        ],
        error: "",
      }),
      resolveFactoryContextFn: ({ factoryId, targetRepo }) => ({
        factory_id: factoryId,
        instance_id: factoryId,
        target_repo: targetRepo,
        control_plane_repo: "recallnet/astrochicken",
        factory_root: `/tmp/${factoryId}`,
        runs_dir: `/tmp/runs/${factoryId}`,
      }),
      factoryStatusFn: () => ({ active: [], blocked_control_plane: [], control_plane: { resume_reason: "ready_to_resume" } }),
      factoryActiveSummaryFn: () => ({ waves: [], non_wave_active: [] }),
      tickStatusFn: () => ({ ticks: [{ stageLabel: "Idle" }] }),
      hostHealthFn: (args) => {
        hostHealthCall = args;
        return { status: "running", running: true, pid: 321, runCount: 1 };
      },
      hostVersionFn: () => ({ version: "v1.0.0" }),
      collectFactoryOutcomesFn: () => ({ merged_prs: 0, closed_features: 0, closed_bugs: 0, merge_commits_main: 0 }),
      factoryReleaseTargetingStatusFn: () => ({ factories: [], warnings: [] }),
    });

    assert.equal(report.factories[0].daemon_health.running, true);
    assert.ok(hostHealthCall, "hostHealthFn must be called");
    assert.equal(hostHealthCall.paths.baseDir, hostBaseDir);
    assert.equal(hostHealthCall.pidFile, join(hostBaseDir, "brainstorm", "pid", "factory-daemon.pid"));
    assert.equal(hostHealthCall.logsDir, join(hostBaseDir, "brainstorm", "logs"));
    assert.equal(hostHealthCall.runsDir, join(hostBaseDir, "brainstorm", "runs"));
    assert.equal(hostHealthCall.env.HATCH_HOST_BASE_DIR, hostBaseDir);
  } finally {
    if (originalHostBaseDir === undefined) delete process.env.HATCH_HOST_BASE_DIR;
    else process.env.HATCH_HOST_BASE_DIR = originalHostBaseDir;
  }
});

test("factoryFleetStatus keeps mothership on canonical runs while external factories prefer host-scoped runs", async () => {
  const originalHostBaseDir = process.env.HATCH_HOST_BASE_DIR;
  const hostBaseDir = mkdtempSync(join(tmpdir(), "fleet-host-runs-choice-"));
  process.env.HATCH_HOST_BASE_DIR = hostBaseDir;
  mkdirSync(join(hostBaseDir, "brainstorm", "runs"), { recursive: true });
  try {
    const calls = [];
    const report = await buildFactoryFleetProjection({
      readFactoryRegistryFn: () => ({
        ok: true,
        reason: "ok",
        registry_path: "/tmp/factory-registry.json",
        factories: [
          { factory_id: "mothership", target_repo: "recallnet/astrochicken", graphs: [], daemon_status: { status: "running" } },
          { factory_id: "brainstorm", target_repo: "example-org/example-notes", graphs: [], daemon_status: { status: "running" } },
        ],
        error: "",
      }),
      resolveFactoryContextFn: ({ factoryId, targetRepo }) => ({
        factory_id: factoryId,
        instance_id: factoryId,
        target_repo: targetRepo,
        control_plane_repo: "recallnet/astrochicken",
        factory_root: `/tmp/${factoryId}`,
        runs_dir: `/tmp/runs/${factoryId}`,
      }),
      factoryStatusFn: ({ runsDir, context }) => {
        calls.push({ factoryId: context.factory_id, runsDir });
        return { active: [], blocked_control_plane: [], control_plane: { resume_reason: "ready_to_resume" } };
      },
      factoryActiveSummaryFn: () => ({ waves: [], non_wave_active: [] }),
      tickStatusFn: () => ({ ticks: [{ stageLabel: "Idle" }] }),
      hostHealthFn: () => ({ status: "running", running: true, pid: 321, runCount: 1 }),
      hostVersionFn: () => ({ version: "v1.0.0" }),
      collectFactoryOutcomesFn: () => ({ merged_prs: 0, closed_features: 0, closed_bugs: 0, merge_commits_main: 0 }),
      factoryReleaseTargetingStatusFn: () => ({ factories: [], warnings: [] }),
    });

    assert.equal(report.factories.length, 2);
    const mothershipCall = calls.find((entry) => entry.factoryId === "mothership");
    const brainstormCall = calls.find((entry) => entry.factoryId === "brainstorm");
    assert.equal(mothershipCall.runsDir, "/tmp/runs/mothership");
    assert.equal(brainstormCall.runsDir, join(hostBaseDir, "brainstorm", "runs"));
  } finally {
    if (originalHostBaseDir === undefined) delete process.env.HATCH_HOST_BASE_DIR;
    else process.env.HATCH_HOST_BASE_DIR = originalHostBaseDir;
  }
});

test("factoryFleetStatus projects recent host activity from completed runs for idle factories", async () => {
  const hostBaseDir = mkdtempSync(join(tmpdir(), "fleet-recent-host-"));
  const runsDir = join(hostBaseDir, "brainstorm", "runs");
  mkdirSync(join(runsDir, "run-1"), { recursive: true });
  writeFileSync(join(runsDir, "run-1", "state.json"), JSON.stringify({
    runId: "run-1",
    status: "completed",
    updatedAt: "2026-03-18T15:58:00.000Z",
    pipelineFile: "/tmp/goal_execute.dot",
    currentNode: "done",
    context: {
      issue_number: 1231,
    },
  }, null, 2));

  const originalHostBaseDir = process.env.HATCH_HOST_BASE_DIR;
  process.env.HATCH_HOST_BASE_DIR = hostBaseDir;
  try {
    const report = await buildFactoryFleetProjection({
      now: Date.parse("2026-03-18T16:00:00.000Z"),
      lookbackHours: 6,
      readFactoryRegistryFn: () => ({
        ok: true,
        reason: "ok",
        registry_path: "/tmp/factory-registry.json",
        factories: [
          { factory_id: "brainstorm", target_repo: "example-org/example-notes", graphs: [], daemon_status: { status: "running" } },
        ],
        error: "",
      }),
      resolveFactoryContextFn: ({ factoryId, targetRepo }) => ({
        factory_id: factoryId,
        instance_id: factoryId,
        target_repo: targetRepo,
        control_plane_repo: "recallnet/astrochicken",
        factory_root: `/tmp/${factoryId}`,
        runs_dir: `/tmp/runs/${factoryId}`,
      }),
      factoryStatusFn: () => ({ active: [], blocked_control_plane: [], control_plane: { resume_reason: "ready_to_resume" } }),
      factoryActiveSummaryFn: () => ({ waves: [], non_wave_active: [] }),
      tickStatusFn: () => ({ ticks: [{ stageLabel: "Done" }] }),
      hostHealthFn: () => ({ status: "running", running: true, pid: 321, runCount: 1 }),
      hostVersionFn: () => ({ version: "v1.0.0" }),
      collectFactoryOutcomesFn: () => ({ merged_prs: 0, closed_features: 0, closed_bugs: 0, merge_commits_main: 0 }),
      factoryReleaseTargetingStatusFn: () => ({ factories: [], warnings: [] }),
    });

    assert.equal(report.factories.length, 1);
    assert.deepEqual(report.factories[0].active_issues, []);
    assert.equal(report.factories[0].health, "idle");
    assert.equal(report.factories[0].recent_host_activity.count, 1);
    assert.equal(report.factories[0].recent_host_activity.latest_issue, 1231);
    assert.match(report.factories[0].recent_host_activity.latest_summary, /completed #1231 2m0s ago/);
  } finally {
    if (originalHostBaseDir === undefined) delete process.env.HATCH_HOST_BASE_DIR;
    else process.env.HATCH_HOST_BASE_DIR = originalHostBaseDir;
  }
});

test("factoryFleetStatus keeps shared capability active runs for managed factories", async () => {
  const originalHostBaseDir = process.env.HATCH_HOST_BASE_DIR;
  process.env.HATCH_HOST_BASE_DIR = mkdtempSync(join(tmpdir(), "fleet-shared-capability-host-"));
  const runsDir = mkdtempSync(join(tmpdir(), "fleet-shared-capability-runs-"));
  writeFileSync(join(runsDir, ".keep"), "");
  const runDir = join(runsDir, "merge-review");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "state.json"), JSON.stringify({
    runId: "merge-review",
    status: "running",
    currentNode: "review_merge",
    updatedAt: "2026-03-18T16:00:00.000Z",
    pipelineFile: "/tmp/packages/capability-merge/workflows/merge_item/merge_item.workflow-source.mjs",
    pipeline: "/tmp/packages/capability-merge/workflows/merge_item/merge_item.workflow-source.mjs",
    context: {
      factory_id: "example-trading",
      instance_id: "example-trading",
      target_repo: "example-org/example-trading",
      issue_number: 1231,
      milestone_title: "goal-1230-wave-1",
    },
  }, null, 2));

  try {
    const report = await buildFactoryFleetProjection({
      now: Date.parse("2026-03-18T16:05:00.000Z"),
      lookbackHours: 6,
      readFactoryRegistryFn: () => ({
        ok: true,
        reason: "ok",
        registry_path: "/tmp/factory-registry.json",
        factories: [
          { factory_id: "example-trading", target_repo: "example-org/example-trading", graphs: [], daemon_status: { status: "running" } },
        ],
        error: "",
      }),
      resolveFactoryContextFn: ({ factoryId, targetRepo }) => ({
        factory_id: factoryId,
        instance_id: factoryId,
        target_repo: targetRepo,
        control_plane_repo: "recallnet/astrochicken",
        factory_root: `/tmp/${factoryId}`,
        runs_dir: runsDir,
      }),
      factoryStatusFn: () => ({
        active: [{
          id: "merge-review",
          issue: "1231",
          node: "review_merge",
          graph: "/tmp/packages/capability-merge/workflows/merge_item/merge_item.workflow-source.mjs",
          milestone: "goal-1230-wave-1",
        }],
        blocked_control_plane: [],
        control_plane: { resume_reason: "ready_to_resume" },
      }),
      factoryActiveSummaryFn: () => ({
        waves: [],
        non_wave_active: [{ issue_number: "1231" }],
      }),
      tickStatusFn: () => ({ ticks: [] }),
      hostHealthFn: () => ({ status: "running", running: true, pid: 321, runCount: 1 }),
      hostVersionFn: () => ({ version: "v1.0.0" }),
      collectFactoryOutcomesFn: () => ({ merged_prs: 0, closed_features: 0, closed_bugs: 0, merge_commits_main: 0 }),
      factoryReleaseTargetingStatusFn: () => ({ factories: [], warnings: [] }),
    });

    assert.equal(report.factories.length, 1);
    assert.deepEqual(report.factories[0].active_issues, [1231]);
    assert.equal(report.factories[0].health, "healthy");
    assert.match(report.factories[0].active_work_summary, /issues=1231/);
  } finally {
    if (originalHostBaseDir === undefined) delete process.env.HATCH_HOST_BASE_DIR;
    else process.env.HATCH_HOST_BASE_DIR = originalHostBaseDir;
  }
});

test("factoryFleetStatus marks GH outcomes degradation from default outcomes helper", async () => {
  const report = await buildFactoryFleetProjection({
    readFactoryRegistryFn: () => ({
      ok: true,
      reason: "ok",
      registry_path: "/tmp/factory-registry.json",
      factories: [
        { factory_id: "alpha", target_repo: "acme/alpha", graphs: [], daemon_status: { status: "running" } },
      ],
      error: "",
    }),
    resolveFactoryContextFn: ({ factoryId, targetRepo }) => ({
      factory_id: factoryId,
      target_repo: targetRepo,
      control_plane_repo: "recallnet/astrochicken",
      factory_root: `/tmp/${factoryId}`,
      runs_dir: `/tmp/runs/${factoryId}`,
    }),
    factoryStatusFn: () => ({ active: [{ issue: "1" }], blocked_control_plane: [], control_plane: { resume_reason: "ready_to_resume" } }),
    factoryActiveSummaryFn: () => ({ waves: [{ milestone_title: "goal-1-wave-1", current_issue_number: 1 }], non_wave_active: [] }),
    tickStatusFn: () => ({ ticks: [{ stageLabel: "Executing wave" }] }),
    hostHealthFn: () => ({ status: "running", running: true, pid: 11, runCount: 1 }),
    hostVersionFn: () => ({ version: "v1.0.0" }),
    collectFactoryOutcomesFn: (args) => collectFactoryOutcomes({
      ...args,
      nowMs: Date.parse("2026-03-09T00:00:00.000Z"),
      spawnSyncFn: (command) => {
        if (command === "git") return { status: 1, stdout: "", stderr: "fatal: not a git repository" };
        return { status: 1, stdout: "", stderr: "unsupported" };
      },
    }),
    factoryReleaseTargetingStatusFn: () => ({ factories: [], warnings: [] }),
  });

  assert.equal(report.factories.length, 1);
  // Git failure produces empty outcomes but not degraded (no gh calls to fail)
  assert.equal(report.factories[0].outcomes_degraded, false);
});

test("formatFleetStatusHuman prints per-factory why lines and fleet totals", () => {
  const output = formatFleetStatusHuman({
    generated_at: "2026-03-09T00:00:00.000Z",
    fleet_totals: {
      total_factories: 2,
      healthy: 1,
      blocked: 1,
      upgrading: 0,
      idle: 0,
      unhealthy: 0,
      active_waves: 1,
      active_issues: 1,
      drift_ready: 1,
      drift_blocked: 1,
      drift_lagging: 0,
      drift_unknown: 0,
    },
    warnings: ["beta:outcomes_degraded:gh_failed"],
    factories: [
      {
        factory_id: "beta",
        target_repo: "acme/beta",
        health: "blocked",
        release_state: "blocked",
        drift_state: "blocked",
        rollout_channel: "stable",
        runtime_version: "v1.0.0",
        kind_version: "brainstorm",
        blocked_reason: "await gate",
        active_waves: ["goal-2-wave-1"],
        active_issues: [20],
        recent_outcomes: [{ summary: "merged_prs=0" }],
        daemon_health: { status: "running", running: true },
        errors: [],
      },
      {
        factory_id: "alpha",
        target_repo: "acme/alpha",
        health: "healthy",
        release_state: "ready",
        drift_state: "ready",
        rollout_channel: "stable",
        runtime_version: "v1.0.0",
        kind_version: "brainstorm",
        blocked_reason: null,
        active_waves: ["goal-1-wave-1"],
        active_issues: [10],
        recent_outcomes: [{ summary: "merged_prs=2" }],
        daemon_health: { status: "running", running: true },
        errors: [],
      },
    ],
  });

  assert.match(output, /Fleet totals total=2 healthy=1 disabled=0 blocked=1/);
  assert.match(output, /drift_ready=1 drift_blocked=1 drift_lagging=0 drift_unknown=0/);
  assert.match(output, /alpha repo=acme\/alpha health=healthy release=ready drift=ready channel=stable runtime=v1\.0\.0 kind=brainstorm/);
  assert.match(output, /beta repo=acme\/beta health=blocked release=blocked drift=blocked channel=stable runtime=v1\.0\.0 kind=brainstorm/);
  assert.match(output, /why=await gate/);
  assert.match(output, /Data degraded: 1 warning/);
});

test("formatFleetStatusHuman prefers managed_state.reason in why field", () => {
  const output = formatFleetStatusHuman({
    generated_at: "2026-03-09T00:00:00.000Z",
    fleet_totals: {
      total_factories: 1,
      healthy: 0,
      blocked: 1,
      upgrading: 0,
      idle: 0,
      unhealthy: 0,
      active_waves: 0,
      active_issues: 0,
      drift_ready: 0,
      drift_blocked: 1,
      drift_lagging: 0,
      drift_unknown: 0,
    },
    warnings: [],
    factories: [
      {
        factory_id: "example-trading",
        target_repo: "example-org/example-trading",
        health: "blocked",
        release_state: "blocked",
        drift_state: "blocked",
        rollout_channel: "stable",
        runtime_version: "v1.0.0",
        kind_version: "example-trading",
        blocked_reason: "release gate blocked",
        managed_state: {
          state_action: "quarantine",
          reason: "upstream bug #42 open",
          retry_target: "",
          health_classification: "control_plane_blocked",
        },
        active_waves: [],
        active_issues: [],
        recent_outcomes: [{ summary: "merged_prs=0" }],
        daemon_health: { status: "running", running: true },
        errors: [],
      },
    ],
  });

  assert.match(output, /example-trading repo=example-org\/example-trading health=blocked release=blocked drift=blocked channel=stable runtime=v1\.0\.0 kind=example-trading/);
  assert.match(output, /why=upstream bug #42 open/);
  assert.doesNotMatch(output, /why=release gate blocked/);
});

test("factoryFleetStatus degrades release-targeting warnings into fleet warnings", async () => {
  const report = await buildFactoryFleetProjection({
    readFactoryRegistryFn: () => ({
      ok: true,
      reason: "ok",
      registry_path: "/tmp/factory-registry.json",
      factories: [
        { factory_id: "alpha", kind_id: "brainstorm", target_repo: "acme/alpha", graphs: [], daemon_status: { status: "running" } },
      ],
      error: "",
    }),
    resolveFactoryContextFn: ({ factoryId, targetRepo }) => ({
      factory_id: factoryId,
      target_repo: targetRepo,
      control_plane_repo: "recallnet/astrochicken",
      factory_root: `/tmp/${factoryId}`,
      runs_dir: `/tmp/runs/${factoryId}`,
    }),
    factoryStatusFn: () => ({ active: [], blocked_control_plane: [], control_plane: { resume_reason: "ready_to_resume" } }),
    factoryActiveSummaryFn: () => ({ waves: [], non_wave_active: [] }),
    tickStatusFn: () => ({ ticks: [{ stageLabel: "Idle" }] }),
    hostHealthFn: () => ({ status: "running", running: true, pid: 11, runCount: 1 }),
    hostVersionFn: () => ({ version: "v1.0.0" }),
    collectFactoryOutcomesFn: () => ({ merged_prs: 0, closed_features: 0, closed_bugs: 0, merge_commits_main: 0 }),
    factoryReleaseTargetingStatusFn: () => ({
      factories: [],
      warnings: ["alpha:manifest_fetch_failed"],
    }),
  });

  assert.equal(report.factories.length, 1);
  assert.ok(report.warnings.some((entry) => entry.includes("release_targeting:alpha:manifest_fetch_failed")));
});

test("factoryFleetStatus uses injected collectFactoryRowsFn when provided", async () => {
  let capturedArgs = null;
  const mockCollectRows = (args) => {
    capturedArgs = args;
    return args.entries.map((entry) => ({
      row: {
        factory_id: String(entry.factory_id || "unknown"),
        target_repo: null,
        control_plane_repo: null,
        factory_root: null,
        runs_dir: null,
        version: null,
        runtime_version: "v0.0.0",
        runtime_version_source: "mock",
        kind_version: "mock",
        release_state: "ready",
        blocked_reason: null,
        managed_state: { state_action: "none", reason: "", retry_target: "", health_classification: "healthy" },
        active_waves: [],
        active_issues: [],
        active_work_summary: "waves=none issues=none",
        blocked_control_plane: [],
        control_plane_blocker: null,
        daemon_health: { status: "running", running: true, pid: null, run_count: 0, run_id: null, last_tick_at: null },
        recent_host_activity: { count: 0, latest_summary: "", latest_status: "", latest_graph: "", latest_issue: null, latest_updated_at: "", latest_updated_ms: 0 },
        recent_outcomes: [],
        outcomes_degraded: false,
        rollout_channel: "unknown",
        rollout_status: "unknown",
        gate_reason: "unknown",
        gate_allowed: false,
        selected_for_canary: false,
        resume_blocked: false,
        release_identity: { release_id: "", release_tag: "", release_sha: "" },
        required_factory_release: "",
        upgrade_verification_outcome: "unknown",
        drift_state: "unknown",
        warnings: [],
        errors: [],
        health: "idle",
      },
      warnings: [],
    }));
  };

  const report = await buildFactoryFleetProjection({
    readFactoryRegistryFn: () => ({
      ok: true,
      reason: "ok",
      registry_path: "/tmp/factory-registry.json",
      factories: [
        { factory_id: "par-a", target_repo: "test/a", graphs: [] },
        { factory_id: "par-b", target_repo: "test/b", graphs: [] },
        { factory_id: "par-c", target_repo: "test/c", graphs: [] },
      ],
      error: "",
    }),
    collectFactoryRowsFn: mockCollectRows,
    factoryReleaseTargetingStatusFn: () => ({ factories: [], warnings: [] }),
  });

  assert.ok(capturedArgs, "collectFactoryRowsFn must be called");
  assert.equal(capturedArgs.entries.length, 3, "all 3 entries passed");
  assert.equal(report.factories.length, 3, "all 3 rows returned");
  assert.deepEqual(
    report.factories.map((r) => r.factory_id).sort(),
    ["par-a", "par-b", "par-c"],
  );
});

test("factoryFleetStatus resolves cross-repo runs_dir via factory config work_dir when host-scoped runs missing", async () => {
  const root = mkdtempSync(join(tmpdir(), "fleet-cross-repo-"));
  const factoryRoot = join(root, "factories", "example-trading");
  mkdirSync(factoryRoot, { recursive: true });

  // Simulate a cross-repo factory: work_dir points to a separate checkout
  const workDir = join(root, "external-repo");
  const externalRunsDir = join(workDir, ".hatch", "example-trading", "runs");
  mkdirSync(join(externalRunsDir, "run-1"), { recursive: true });
  writeFileSync(join(externalRunsDir, "run-1", "state.json"), JSON.stringify({
    runId: "run-1",
    status: "completed",
    updatedAt: "2026-03-18T16:00:00.000Z",
    pipelineFile: "/tmp/factory_supervisor_tick.dot",
    currentNode: "done",
    context: {},
  }, null, 2));

  // Write factory.config.json with work_dir and runs_dir
  writeFileSync(join(factoryRoot, "factory.config.json"), JSON.stringify({
    factory_root: "factories/example-trading",
    target_repo: "example-org/example-trading",
    control_plane_repo: "recallnet/astrochicken",
    work_dir: workDir,
    runs_dir: ".hatch/example-trading/runs",
  }, null, 2));

  const originalHostBaseDir = process.env.HATCH_HOST_BASE_DIR;
  const hostBaseDir = join(root, "hatch-hosts");
  mkdirSync(join(hostBaseDir, "example-trading", "pid"), { recursive: true });
  // No runs dir under host path — simulates current state
  process.env.HATCH_HOST_BASE_DIR = hostBaseDir;

  try {
    const calls = [];
    const report = await buildFactoryFleetProjection({
      now: Date.parse("2026-03-18T16:30:00.000Z"),
      lookbackHours: 24,
      readFactoryRegistryFn: () => ({
        ok: true,
        reason: "ok",
        registry_path: join(root, "factory-registry.json"),
        factories: [
          { factory_id: "example-trading", target_repo: "example-org/example-trading", graphs: [], daemon_status: { status: "running" } },
        ],
        error: "",
      }),
      resolveFactoryContextFn: ({ factoryId, targetRepo }) => ({
        factory_id: factoryId,
        instance_id: factoryId,
        target_repo: targetRepo,
        control_plane_repo: "recallnet/astrochicken",
        factory_root: factoryRoot,
        runs_dir: join(root, ".hatch", "example-trading", "runs"), // wrong — relative to control plane repo
      }),
      factoryStatusFn: ({ runsDir, context }) => {
        calls.push({ factoryId: context.factory_id, runsDir });
        return { active: [], blocked_control_plane: [], control_plane: { resume_reason: "ready_to_resume" } };
      },
      factoryActiveSummaryFn: () => ({ waves: [], non_wave_active: [] }),
      tickStatusFn: () => ({ ticks: [] }),
      hostHealthFn: () => ({ status: "running", running: true, pid: 999, runCount: 5 }),
      hostVersionFn: () => ({ version: "v1.0.0" }),
      collectFactoryOutcomesFn: () => ({ merged_prs: 0, closed_features: 0, closed_bugs: 0, merge_commits_main: 0 }),
      factoryReleaseTargetingStatusFn: () => ({ factories: [], warnings: [] }),
    });

    assert.equal(report.factories.length, 1);
    assert.equal(calls.length, 1);
    // Must resolve to the work_dir-based runs path, not the control-plane-relative one
    assert.equal(calls[0].runsDir, externalRunsDir, "cross-repo factory must use work_dir-resolved runs_dir");
    // No runs_dir_missing warning
    const runsDirWarning = (report.warnings || []).find((w) => w.includes("runs_dir_missing"));
    assert.equal(runsDirWarning, undefined, "should not emit runs_dir_missing when work_dir resolves correctly");
  } finally {
    if (originalHostBaseDir === undefined) delete process.env.HATCH_HOST_BASE_DIR;
    else process.env.HATCH_HOST_BASE_DIR = originalHostBaseDir;
  }
});

test("collectFactoryRowsSequential collects rows from all entries and propagates per-factory warnings", () => {
  const results = collectFactoryRowsSequential({
    entries: [
      { factory_id: "seq-a", target_repo: "test/a", graphs: [] },
      { factory_id: "seq-b", target_repo: "test/b", graphs: [] },
    ],
    baseContext: { control_plane_repo: "test/cp" },
    factoryStatusFn: () => ({ active: [], blocked_control_plane: [], control_plane: { resume_reason: "ready_to_resume" } }),
    factoryActiveSummaryFn: () => ({ waves: [], non_wave_active: [] }),
    tickStatusFn: () => ({ ticks: [] }),
    hostHealthFn: () => ({ status: "running", running: true, pid: 1, runCount: 1 }),
    hostVersionFn: () => ({ version: "v1.0.0" }),
    collectFactoryOutcomesFn: () => ({ merged_prs: 0, closed_features: 0, closed_bugs: 0, merge_commits_main: 0 }),
  });

  assert.equal(results.length, 2);
  assert.equal(results[0].row.factory_id, "seq-a");
  assert.equal(results[1].row.factory_id, "seq-b");
  assert.ok(Array.isArray(results[0].warnings));
  assert.ok(Array.isArray(results[1].warnings));
});

test("collectFactoryRowsSequential handles entry throws gracefully with fallback rows", () => {
  const results = collectFactoryRowsSequential({
    entries: [
      { factory_id: "ok-factory", target_repo: "test/ok", graphs: [] },
      { factory_id: "boom-factory", target_repo: "test/boom", graphs: [] },
    ],
    baseContext: { control_plane_repo: "test/cp" },
    resolveFactoryContextFn: ({ factoryId }) => {
      if (factoryId === "boom-factory") throw new Error("resolver exploded");
      return {
        factory_id: factoryId,
        target_repo: `test/${factoryId}`,
        control_plane_repo: "test/cp",
        factory_root: `/tmp/${factoryId}`,
        runs_dir: `/tmp/runs/${factoryId}`,
      };
    },
    factoryStatusFn: () => ({ active: [], blocked_control_plane: [], control_plane: { resume_reason: "ready_to_resume" } }),
    factoryActiveSummaryFn: () => ({ waves: [], non_wave_active: [] }),
    tickStatusFn: () => ({ ticks: [] }),
    hostHealthFn: () => ({ status: "running", running: true, pid: 1, runCount: 1 }),
    hostVersionFn: () => ({ version: "v1.0.0" }),
    collectFactoryOutcomesFn: () => ({ merged_prs: 0, closed_features: 0, closed_bugs: 0, merge_commits_main: 0 }),
  });

  assert.equal(results.length, 2);
  assert.notEqual(results[0].row.health, "unhealthy");
  assert.equal(results.length, 2);
});

test("collectFactoryRow is exported and callable", () => {
  assert.equal(typeof collectFactoryRow, "function");
});

test("createDefaultFleetRowDeps wires canonical fleet dependencies", () => {
  const deps = createDefaultFleetRowDeps();

  assert.equal(deps.factoryStatusFn, canonicalFactoryStatus);
  assert.equal(deps.factoryActiveSummaryFn, factoryActiveSummary);
  assert.equal(deps.tickStatusFn, lowLevelTickStatus);
});

test("collectFactoryRowsParallel is exported and callable", () => {
  assert.equal(typeof collectFactoryRowsParallel, "function");
});
