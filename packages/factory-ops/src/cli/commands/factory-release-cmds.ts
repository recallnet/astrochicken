import { Command, Option } from "clipanion";

import {
  resolveRepoOrExit,
} from "../factory-command-helpers.ts";
import { parsePositiveNumber, parseJsonObjectFlag } from "../helpers.ts";

export class FactoryReleaseTargetingStatusCommand extends Command {
  static paths = [["factory", "release-targeting-status"]];
  registryPath = Option.String("--registry-path", "factory-registry.json");
  policyPath = Option.String("--policy-path", "");
  policyJson = Option.String("--policy-json", "");
  localReleaseCmdByFactory = Option.String("--local-release-cmd-by-factory", "");
  manifestPath = Option.String("--manifest-path", "");
  manifestRef = Option.String("--manifest-ref", "");
  manifestFetchCmd = Option.String("--manifest-fetch-cmd", "");
  json = Option.Boolean("--json", false);

  async execute() {
    const {
      factoryReleaseTargetingStatus,
      formatReleaseTargetingStatusHuman,
    } = await import("../../commands/factory-release-targeting-status.ts");

    const localReleaseCmdParse = parseJsonObjectFlag({
      raw: this.localReleaseCmdByFactory,
      flagName: "local-release-cmd-by-factory",
    });
    if (!localReleaseCmdParse.ok) {
      this.context.stderr.write(`${localReleaseCmdParse.error}\n`);
      return 2;
    }
    const parsedLocalReleaseCmdByFactory = localReleaseCmdParse.value;

    const report = await factoryReleaseTargetingStatus({
      registryPath: this.registryPath,
      policyPath: this.policyPath,
      policyJson: this.policyJson,
      localReleaseCmdByFactory: parsedLocalReleaseCmdByFactory,
      manifestPath: this.manifestPath,
      manifestRef: this.manifestRef,
      manifestFetchCmd: this.manifestFetchCmd,
    });

    if (this.json) {
      this.context.stdout.write(JSON.stringify(report, null, 2));
    } else {
      this.context.stdout.write(formatReleaseTargetingStatusHuman(report));
    }

    return Number(report?.fleet_totals?.manifest_failures || 0) > 0 ? 1 : 0;
  }
}

export class FactoryUpgradePostureInspectCommand extends Command {
  static paths = [["factory", "upgrade-posture", "inspect"]];
  instanceId = Option.String();
  registryPath = Option.String("--registry-path", "factory-registry.json");
  policyPath = Option.String("--policy-path", "factories/mothership/policy-pack/v1/release-policy.json");
  json = Option.Boolean("--json", false);

  async execute() {
    const {
      inspectFactoryUpgradePosture,
      formatFactoryUpgradePostureInspectHuman,
    } = await import("../../commands/factory-upgrade-posture.ts");

    try {
      const out = inspectFactoryUpgradePosture({
        instanceId: this.instanceId,
        registryPath: this.registryPath,
        policyPath: this.policyPath,
      });

      if (this.json) {
        this.context.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
      } else {
        this.context.stdout.write(`${formatFactoryUpgradePostureInspectHuman(out)}\n`);
      }
      return 0;
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      return 1;
    }
  }
}

export class FactoryUpgradePostureCohortCommand extends Command {
  static paths = [["factory", "upgrade-posture", "cohort"]];
  selector = Option.String();
  channel = Option.String("--channel", "");
  pinVersion = Option.String("--pin-version", "");
  registryPath = Option.String("--registry-path", "factory-registry.json");
  policyPath = Option.String("--policy-path", "factories/mothership/policy-pack/v1/release-policy.json");
  auditLogPath = Option.String("--audit-log-path", ".hatch/upgrade-posture/audit-log.jsonl");
  actor = Option.String("--actor", "");
  dryRun = Option.Boolean("--dry-run", false);
  json = Option.Boolean("--json", false);

  async execute() {
    const {
      updateFactoryUpgradePostureCohort,
      formatFactoryUpgradePostureCohortHuman,
    } = await import("../../commands/factory-upgrade-posture.ts");

    try {
      const out = updateFactoryUpgradePostureCohort({
        selector: this.selector,
        channel: this.channel,
        pinVersion: this.pinVersion,
        registryPath: this.registryPath,
        policyPath: this.policyPath,
        auditLogPath: this.auditLogPath,
        actor: this.actor,
        dryRun: this.dryRun,
      });

      if (this.json) {
        this.context.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
      } else {
        this.context.stdout.write(`${formatFactoryUpgradePostureCohortHuman(out)}\n`);
      }
      return 0;
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      return 1;
    }
  }
}

export class FactoryPublishControlPlaneManifestCommand extends Command {
  static paths = [["factory", "publish-control-plane-manifest"]];
  manifestPath = Option.String("--manifest-path", { required: true });
  repoRoot = Option.String("--repo-root", ".");
  async execute() {
    const { syncControlPlaneManifest } = await import("../../lib/control-plane-manifest.ts");
    const out = syncControlPlaneManifest({ manifestPath: this.manifestPath, repoRoot: this.repoRoot });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class FactoryReleaseRolloutControllerCommand extends Command {
  static paths = [["factory", "release-rollout-controller"]];
  repo = Option.String("--repo", "");
  repoPath = Option.String("--repo-path", ".");
  candidateManifestPath = Option.String("--candidate-manifest-path", "");
  releasesDir = Option.String("--releases-dir", ".hatch/releases");
  runsDir = Option.String("--runs-dir", ".hatch/runs");
  canaryManifestPath = Option.String("--canary-manifest-path", ".hatch/releases/canary/release-manifest.json");
  generalManifestPath = Option.String("--general-manifest-path", ".hatch/releases/stable/release-manifest.json");
  canaryMaxFactories = Option.String("--canary-max-factories", "1");
  healthPolicyJson = Option.String("--health-policy-json", "");
  trackingIssue = Option.String("--tracking-issue", "");
  factoryId = Option.String("--factory-id", "mothership/release_rollout_controller");
  runId = Option.String("--run-id", "");
  holderId = Option.String("--holder-id", "");
  hostId = Option.String("--host-id", "");
  processId = Option.String("--process-id", "");
  leaseSeconds = Option.String("--lease-seconds", "600");
  lookbackHours = Option.String("--lookback-hours", "24");

  async execute() {
    const { runReleaseRolloutController } = await import("../../commands/release-rollout-controller.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    const out = await runReleaseRolloutController({
      repo,
      repoPath: this.repoPath,
      candidateManifestPath: this.candidateManifestPath,
      releasesDir: this.releasesDir,
      runsDir: this.runsDir,
      canaryManifestPath: this.canaryManifestPath,
      generalManifestPath: this.generalManifestPath,
      canaryMaxFactories: parsePositiveNumber(this.canaryMaxFactories, 1),
      healthPolicyJson: this.healthPolicyJson,
      trackingIssue: this.trackingIssue,
      factoryId: this.factoryId,
      runId: this.runId,
      holderId: this.holderId,
      hostId: this.hostId,
      processId: this.processId,
      leaseSeconds: parsePositiveNumber(this.leaseSeconds, 600),
      lookbackHours: parsePositiveNumber(this.lookbackHours, 24),
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class FactoryStampContractHashCommand extends Command {
  static paths = [["factory", "stamp-contract-hash"]];
  factoryRoot = Option.String("--factory-root", "");
  async execute() {
    const { computeFactoryContractHash } = await import("../../lib/factory-contract-drift.ts");
    const hash = computeFactoryContractHash({ factoryRoot: this.factoryRoot });
    this.context.stdout.write(hash || "");
    return 0;
  }
}

export const factoryReleaseCommands = [
  FactoryReleaseTargetingStatusCommand,
  FactoryUpgradePostureInspectCommand,
  FactoryUpgradePostureCohortCommand,
  FactoryPublishControlPlaneManifestCommand,
  FactoryReleaseRolloutControllerCommand,
  FactoryStampContractHashCommand,
];
