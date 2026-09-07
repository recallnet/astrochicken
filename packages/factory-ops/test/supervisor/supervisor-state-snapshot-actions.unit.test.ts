import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { appendSupervisorStateSnapshotActionItems } from "../../src/commands/supervisor-state-snapshot-actions.ts";

const FACTORY_OPS_CLI_ENTRYPOINT = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));

test("appendSupervisorStateSnapshotActionItems emits auto-executable cleanup for stale orphan remediation goals", () => {
  const actionItems = [];
  const appendActionItem = (item) => actionItems.push(item);

  appendSupervisorStateSnapshotActionItems({
    repo: "example-org/example-trading",
    normalizedTargetRepo: "example-org/example-trading",
    normalizedControlPlaneRepo: "recallnet/astrochicken",
    normalizedFactoryId: "example-trading",
    resolvedRunsDir: "/tmp/runs",
    nowMs: Date.now(),
    features: [],
    orphanFeatures: [{ number: 1814, title: "Document ladder parser contract" }],
    closedGoalOwnedFeatures: [],
    mergeFollowupsMislabeled: [],
    openMergeFollowups: [],
    unlabeled: [],
    bugs: [],
    openHumanIssues: [],
    staleWaveGiveupBugs: [],
    staleTelemetry: [],
    openWaveReady: [],
    goalSubIssues: {},
    goals: [
      {
        number: 1864,
        title: "Goal: Supervisor Remediation — Orphan Features (20)",
        body: "Orphan-Feature-Signature: sha256:deadbeef",
      },
      {
        number: 1837,
        title: "Goal: Supervisor Remediation — Orphan Features (1)",
        body: "Orphan-Feature-Signature: sha256:3f5ee683014802f018e67eec1c67273a4a7768ec5d54defaf446d8e2c75743df",
      },
    ],
    ghJsonFn: () => [],
    ghPaginatedFn: () => [],
    appendActionItem,
    appendSynthesisActionItem: appendActionItem,
    appendSynthesisActionItems: (items = []) => {
      for (const item of items) appendActionItem(item);
    },
    persistedPacketActionItems: [],
    persistedPacketByDedupeKey: new Map(),
    snapshotErrors: [],
    recoverySweepFn: () => ({ stale_runs: [] }),
    recoverySweepScope: {},
    scanCliCrashesFn: () => [],
    skipRecoverySweep: true,
  });

  const cleanupItem = actionItems.find((item) => item.remediation_packet?.packet_type === "stale_supervisor_goal_cleanup");
  assert.ok(cleanupItem, "expected stale supervisor goal cleanup action item");
  assert.match(cleanupItem.problem, /#1864/);
  assert.equal(
    cleanupItem.remediation_packet.execution_commands[0],
    `node ${FACTORY_OPS_CLI_ENTRYPOINT} supervisor sanitize-goals --repo 'example-org/example-trading'`,
  );
});
