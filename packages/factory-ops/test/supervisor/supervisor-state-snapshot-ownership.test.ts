import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStateSnapshot,
  determineOwnershipDecision,
} from "../../src/commands/supervisor-state-snapshot.ts";

test("determineOwnershipDecision classifies remote CLI runtime crash as control_plane", () => {
  const out = determineOwnershipDecision({
    problem: "CLI_RUNTIME_CRASH: run r-1 failed",
    diagnostics: {
      remediation_policy: "REMOTE_FACTORY_ESCALATE_AND_SUBSCRIBE",
    },
    possible_resolutions: [
      { when: "remote_factory", resolution: "File bug in control_plane_repo" },
    ],
    suggested_action: "APPLY_NOW: node packages/factory-ops/src/cli.ts supervisor emit-bug --repo 'acme/control'",
  }, {
    targetRepo: "acme/target",
    controlPlaneRepo: "acme/control",
  });

  assert.equal(out.decision, "control_plane");
  assert.match(String(out.reason || ""), /control plane|control_plane/i);
});

test("determineOwnershipDecision classifies local CLI runtime crash as local_fix", () => {
  const out = determineOwnershipDecision({
    problem: "CLI_RUNTIME_CRASH: run r-2 failed",
    diagnostics: {
      remediation_policy: "LOCAL_FACTORY_IMMEDIATE_FIX",
    },
    remediation_packet: {
      requires_repo_fix: true,
    },
  }, {
    targetRepo: "acme/target",
    controlPlaneRepo: "acme/control",
  });

  assert.equal(out.decision, "local_fix");
});

test("determineOwnershipDecision classifies explicit defer/cooldown guidance as wait", () => {
  const out = determineOwnershipDecision({
    problem: "UNSCHEDULED_WAVE: milestone lacks marker",
    suggested_action: "Defer until cooldown expires",
    remediation_packet: {
      execution_commands: ["echo defer due to cooldown"],
    },
  }, {
    targetRepo: "acme/target",
    controlPlaneRepo: "acme/control",
  });

  assert.equal(out.decision, "wait");
});

test("determineOwnershipDecision keeps unscheduled wave requeue actionable when cooldown is only hypothetical", () => {
  const out = determineOwnershipDecision({
    problem: "UNSCHEDULED_WAVE: milestone 'goal-1588-wave-3' has 1 open feature issue(s) but no open Wave Ready marker.",
    possible_resolutions: [
      { when: "cooldown_only", resolution: "Recreate/reopen marker after cooldown or with explicit reviewed override." },
      { when: "state_inconsistent", resolution: "Normalize marker labels/state and re-queue deterministically." },
    ],
    remediation_packet: {
      packet_type: "unscheduled_wave_requeue",
      execution_commands: [
        "node packages/factory-ops/src/cli.ts wave create-ready --repo 'recallnet/astrochicken' --selected-waves '[\"goal-1588-wave-3\"]' --cooldown-minutes 0",
      ],
    },
    suggested_action: "Run: node packages/factory-ops/src/cli.ts wave create-ready --repo 'recallnet/astrochicken' --selected-waves '[\"goal-1588-wave-3\"]' --cooldown-minutes 0",
  }, {
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
  });

  assert.equal(out.decision, "local_fix");
});

test("determineOwnershipDecision defaults to local_fix for vanilla remediation packets", () => {
  const out = determineOwnershipDecision({
    problem: "issue has no labels",
    remediation_packet: {
      execution_commands: ["gh issue edit 123 --add-label feature"],
    },
    suggested_action: "Classify and relabel",
  }, {
    targetRepo: "acme/target",
    controlPlaneRepo: "acme/control",
  });

  assert.equal(out.decision, "local_fix");
});

test("buildStateSnapshot emits ownership metadata for local and external contexts", () => {
  const ghJsonFn = () => [];
  const recoverySweepFn = () => ({ stale_runs: [] });
  const scanCliCrashesFn = () => ([
    {
      run_id: "ownership-run",
      pipeline: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
      node: "execute_issue",
      crash_type: "module_not_found",
      file_path: "/tmp/missing.mjs",
      error_excerpt: "ERR_MODULE_NOT_FOUND",
    },
  ]);

  const local = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
    factoryId: "mothership",
    ghJsonFn,
    recoverySweepFn,
    scanCliCrashesFn,
  }));

  const external = JSON.parse(buildStateSnapshot({
    repo: "acme/target-factory",
    targetRepo: "acme/target-factory",
    controlPlaneRepo: "recallnet/astrochicken",
    factoryId: "external/factory_supervisor",
    ghJsonFn,
    recoverySweepFn,
    scanCliCrashesFn,
  }));

  const localIncident = (local.action_items || []).find((item) => String(item.problem || "").startsWith("CLI_RUNTIME_CRASH:"));
  const externalIncident = (external.action_items || []).find(
    (item) => String(item?.remediation_packet?.packet_type || "") === "remote_cli_runtime_crash",
  );

  assert.ok(localIncident, "expected local CLI runtime crash action item");
  assert.ok(externalIncident, "expected external remote_cli_runtime_crash packet-backed action item");

  for (const item of [localIncident, externalIncident]) {
    assert.ok(Object.hasOwn(item, "ownership_decision"), "ownership_decision must exist");
    assert.ok(Object.hasOwn(item, "ownership_reason"), "ownership_reason must exist");
    assert.ok(["local_fix", "control_plane", "wait"].includes(String(item.ownership_decision || "")));
    assert.match(String(item.ownership_reason || ""), /\S/);
  }

  assert.equal(localIncident.ownership_decision, "local_fix");
  assert.equal(externalIncident.ownership_decision, "control_plane");
  assert.equal(String(externalIncident?.remediation_packet?.packet_type || ""), "remote_cli_runtime_crash");
  assert.ok(
    externalIncident?.remediation_packet?.execution_commands?.some((cmd) => String(cmd).includes("supervisor emit-bug")),
    "external incident must include emit-bug escalation command",
  );
});
