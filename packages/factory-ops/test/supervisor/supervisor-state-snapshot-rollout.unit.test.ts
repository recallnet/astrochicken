import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildReleaseManifest } from "../../src/commands/release-manifest.ts";
import { appendSupervisorStateSnapshotActionItems } from "../../src/commands/supervisor-state-snapshot-actions.ts";
import { buildStateSnapshot } from "../../src/commands/supervisor-state-snapshot.ts";

function makeFleetManifestEntry({ sourceRepo, sourceIssue, factoryId, requiredFactoryRelease }) {
  return {
    source_repo: sourceRepo,
    source_issue: sourceIssue,
    source_issue_url: `https://example/${sourceIssue}`,
    summary: `${sourceRepo}#${sourceIssue}`,
    status: "blocked_upstream",
    required_factory_release: requiredFactoryRelease,
    factory_id: factoryId,
    signature_hash: `sha256:${sourceRepo}-${sourceIssue}`,
    linkage: {
      schema_version: "factory_link.v1",
      control_plane_repo: "recallnet/astrochicken",
      control_plane_goal: 7000 + Number(sourceIssue || 0),
      source_repo: sourceRepo,
      source_issue: sourceIssue,
      status: "blocked_upstream",
      factory_id: factoryId,
      required_factory_release: requiredFactoryRelease,
      signature_hash: `sha256:${sourceRepo}-${sourceIssue}`,
    },
  };
}

function makeFleetManifest({ releaseTag, releaseSha, rolloutStatus = "promoted", entries = [] }) {
  const manifest = buildReleaseManifest({
    controlPlaneRepo: "recallnet/astrochicken",
    releaseTag,
    releaseSha,
    entries,
  });
  manifest.rollout.controller.status = rolloutStatus;
  manifest.rollout.controller.stage = rolloutStatus === "promoted" ? "general" : "canary";
  return manifest;
}

function makeGhStub() {
  return (args, fallback = []) => {
    const cmd = Array.isArray(args) ? args.join(" ") : "";
    if (cmd.includes("issue list") || cmd.includes("api repos/")) return [];
    if (cmd.includes("issue view") && cmd.includes("--json state")) return { state: "OPEN" };
    if (cmd.includes("issue view") && cmd.includes("--json comments,state")) return { comments: [], state: "OPEN" };
    return fallback;
  };
}

const FACTORY_OPS_CLI_ENTRYPOINT = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));

test("appendSupervisorStateSnapshotActionItems appends stale-bug action items", () => {
  const actionItems = [];
  const synthesisActionItems = [];
  const persistedPacketActionItems = [];
  const persistedPacketByDedupeKey = new Map();
  const snapshotErrors = [];

  const appendActionItem = (item) => actionItems.push(item);
  const appendSynthesisActionItem = (item) => {
    appendActionItem(item);
    synthesisActionItems.push(item);
  };
  const appendSynthesisActionItems = (items = []) => {
    for (const item of items) appendSynthesisActionItem(item);
  };

  const nowMs = Date.parse("2026-03-12T12:00:00.000Z");
  const staleBugCreatedAt = new Date(nowMs - (2 * 60 * 60 * 1000)).toISOString();

  const out = appendSupervisorStateSnapshotActionItems({
    repo: "recallnet/astrochicken",
    normalizedTargetRepo: "recallnet/astrochicken",
    normalizedControlPlaneRepo: "recallnet/astrochicken",
    normalizedFactoryId: "mothership",
    resolvedRunsDir: join(process.cwd(), ".hatch", "runs"),
    nowMs,
    features: [],
    orphanFeatures: [],
    mergeFollowupsMislabeled: [],
    openMergeFollowups: [],
    unlabeled: [],
    bugs: [
      { number: 901, title: "stale bug", createdAt: staleBugCreatedAt },
    ],
    openHumanIssues: [],
    staleWaveGiveupBugs: [],
    staleTelemetry: [],
    openWaveReady: [],
    ghJsonFn: makeGhStub(),
    readGhList: (key) => {
      if (key === "goals") return [];
      return [];
    },
    appendActionItem,
    appendSynthesisActionItem,
    appendSynthesisActionItems,
    persistedPacketActionItems,
    persistedPacketByDedupeKey,
    snapshotErrors,
    recoverySweepFn: () => ({ stale_runs: [] }),
    scanCliCrashesFn: () => [],
  });

  assert.equal(Array.isArray(out.staleRuns), true);
  assert.equal(Array.isArray(out.cliCrashes), true);
  assert.ok(actionItems.some((item) => item.problem === "open bug older than 1 hour — verify if still reproducible"));
  // Wave action items removed — UNSCHEDULED_WAVE and STALLED_WAVE no longer emitted
  assert.ok(!actionItems.some((item) => String(item.problem || "").startsWith("UNSCHEDULED_WAVE:")));
  assert.equal(snapshotErrors.length, 0);
});

test("appendSupervisorStateSnapshotActionItems emits absolute orphan remediation CLI commands", () => {
  const actionItems = [];
  const appendActionItem = (item) => actionItems.push(item);
  const appendSynthesisActionItem = (item) => appendActionItem(item);
  const appendSynthesisActionItems = (items = []) => {
    for (const item of items) appendSynthesisActionItem(item);
  };

  appendSupervisorStateSnapshotActionItems({
    repo: "example-org/example-trading",
    normalizedTargetRepo: "example-org/example-trading",
    normalizedControlPlaneRepo: "recallnet/astrochicken",
    normalizedFactoryId: "example-trading",
    resolvedRunsDir: join(process.cwd(), ".hatch", "runs"),
    nowMs: Date.parse("2026-03-31T14:00:00.000Z"),
    features: [],
    orphanFeatures: [
      { number: 1814, title: "Document and release the public ladder bucket parser contract in @example-org/core-domain" },
    ],
    mergeFollowupsMislabeled: [],
    openMergeFollowups: [],
    unlabeled: [],
    bugs: [],
    openHumanIssues: [],
    staleWaveGiveupBugs: [],
    staleTelemetry: [],
    openWaveReady: [],
    goals: [],
    goalSubIssues: {},
    ghJsonFn: makeGhStub(),
    appendActionItem,
    appendSynthesisActionItem,
    appendSynthesisActionItems,
    persistedPacketActionItems: [],
    persistedPacketByDedupeKey: new Map(),
    snapshotErrors: [],
    recoverySweepFn: () => ({ stale_runs: [] }),
    scanCliCrashesFn: () => [],
  });

  const item = actionItems.find((entry) => entry.problem === "feature has no parent goal (orphan)");
  assert.ok(item, "expected orphan feature action item");
  assert.equal(
    item.remediation_packet.execution_commands[0],
    `node ${FACTORY_OPS_CLI_ENTRYPOINT} supervisor remediate-orphan-features --repo 'example-org/example-trading'`,
  );
});

test("buildStateSnapshot appends fleet rollout action items when registryPath is provided", () => {
  const root = mkdtempSync(join(tmpdir(), "snapshot-fleet-rollout-"));
  const registryPath = join(root, "factory-registry.json");
  writeFileSync(registryPath, JSON.stringify({
    schema: "hatch.factory.registry.v1",
    factories: [
      {
        id: "blocked-factory",
        repo: "example/blocked",
        graphs: [{ id: "tick", path: "factories/blocked/graphs/factory_supervisor_tick.dot" }],
        daemonStatus: { status: "running" },
      },
      {
        id: "lagging-factory",
        repo: "example/lagging",
        graphs: [{ id: "tick", path: "factories/lagging/graphs/factory_supervisor_tick.dot" }],
        daemonStatus: { status: "running" },
      },
      {
        id: "ready-factory",
        repo: "example/ready",
        graphs: [{ id: "tick", path: "factories/ready/graphs/factory_supervisor_tick.dot" }],
        daemonStatus: { status: "running" },
      },
    ],
  }, null, 2));

  const blockedManifest = makeFleetManifest({
    releaseTag: "v9.0.0-canary",
    releaseSha: "sha-900c",
    rolloutStatus: "rolled_back",
    entries: [
      makeFleetManifestEntry({ sourceRepo: "example/blocked", sourceIssue: 11, factoryId: "blocked-factory", requiredFactoryRelease: "2.0.0" }),
    ],
  });
  const generalManifest = makeFleetManifest({
    releaseTag: "v9.0.0",
    releaseSha: "sha-900",
    rolloutStatus: "promoted",
    entries: [
      makeFleetManifestEntry({ sourceRepo: "example/lagging", sourceIssue: 12, factoryId: "lagging-factory", requiredFactoryRelease: "2.0.0" }),
      makeFleetManifestEntry({ sourceRepo: "example/ready", sourceIssue: 13, factoryId: "ready-factory", requiredFactoryRelease: "2.0.0" }),
    ],
  });

  const encodedBlockedManifest = Buffer.from(JSON.stringify(blockedManifest), "utf8").toString("base64");
  const encodedGeneralManifest = Buffer.from(JSON.stringify(generalManifest), "utf8").toString("base64");
  const out = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn: makeGhStub(),
    recoverySweepFn: () => ({ stale_runs: [] }),
    nowMs: 1_700_100_000_000,
    runsDir: join(process.cwd(), ".hatch", "runs"),
    registryPath,
    policyJson: JSON.stringify({
      control_plane_repo: "recallnet/astrochicken",
      rollout: {
        default_channel: "stable",
        repo_channels: {
          "example/blocked": "canary",
        },
        channels: {
          canary: {
            manifest_fetch_command: `node -e "process.stdout.write(Buffer.from('${encodedBlockedManifest}','base64').toString('utf8'))"`,
          },
          stable: {
            manifest_fetch_command: `node -e "process.stdout.write(Buffer.from('${encodedGeneralManifest}','base64').toString('utf8'))"`,
          },
        },
      },
      localReleaseCmdByFactory: {
        "lagging-factory": "printf '1.0.0\\n'",
        "ready-factory": "printf '3.0.0\\n'",
      },
    }),
  }));

  const blockedItems = (out.action_items || []).filter((item) => item.type === "fleet_rollout_blocked");
  const laggingItems = (out.action_items || []).filter((item) => item.type === "fleet_rollout_lagging");

  assert.equal(blockedItems.length >= 1, true);
  assert.equal(laggingItems.length >= 1, true);

  const blocked = blockedItems.find((item) => item.factory_id === "blocked-factory");
  const lagging = laggingItems.find((item) => item.factory_id === "lagging-factory");
  assert.ok(blocked);
  assert.ok(lagging);
  assert.equal(blocked.gate_reason, "release_rollout_blocked");
  assert.equal(lagging.gate_reason, "factory_release_below_required");
  assert.ok(String(blocked.suggested_action || "").includes("release-targeting-status"));
  assert.ok(String(lagging.suggested_action || "").includes("release-targeting-status"));
});

test("buildStateSnapshot skips fleet rollout logic when registryPath is empty", () => {
  const out = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn: makeGhStub(),
    recoverySweepFn: () => ({ stale_runs: [] }),
    nowMs: 1_700_100_000_000,
    runsDir: join(process.cwd(), ".hatch", "runs"),
    registryPath: "",
    manifestFetchCmd: "exit 1",
  }));

  const fleetItems = (out.action_items || []).filter((item) => String(item.type || "").startsWith("fleet_rollout_"));
  assert.equal(fleetItems.length, 0);
  const rolloutErrors = (out.snapshot_errors || []).filter((entry) => String(entry || "").includes("fleet_rollout_action_items_failed"));
  assert.equal(rolloutErrors.length, 0);
});
