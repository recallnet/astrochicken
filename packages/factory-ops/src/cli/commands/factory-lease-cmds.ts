import { Command, Option } from "clipanion";

import {
  resolveRepoOrExit,
  resolveFactoryContextOrExit,
  resolveFactoryRunsDir,
  resolveHostLifecycleInputs,
  printHostLifecycleJson,
  buildHostLifecycleJson,
  resolveDaemonScriptPath,
  buildHostDaemonEnv,
  executeFactoryControlMutation,
} from "../factory-command-helpers.ts";
import { parsePositiveNumber, parseNonNegativeNumber, parseBoolFlag, parseJsonObjectFlag } from "../helpers.ts";

export class FactoryResolveTrackingIssueCommand extends Command {
  static paths = [["factory", "resolve-tracking-issue"]];
  repo = Option.String("--repo", "");
  trackingIssue = Option.String("--tracking-issue", "");
  json = Option.Boolean("--json", false);

  async execute() {
    const { resolveFactoryTrackingIssueNumber } = await import("../../commands/factory-distributed-lease.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    const out = resolveFactoryTrackingIssueNumber({
      repo,
      trackingIssueNumber: this.trackingIssue,
    });
    if (this.json) {
      this.context.stdout.write(JSON.stringify(out));
    } else {
      this.context.stdout.write(String(out.tracking_issue_number || ""));
    }
    return 0;
  }
}

export class FactoryLeaseAcquireCommand extends Command {
  static paths = [["factory", "lease-acquire"]];
  repo = Option.String("--repo", "");
  factoryId = Option.String("--factory-id", "mothership/factory_supervisor");
  leaseName = Option.String("--lease-name", "");
  runId = Option.String("--run-id", "");
  trackingIssue = Option.String("--tracking-issue", "");
  holderId = Option.String("--holder-id", "");
  hostId = Option.String("--host-id", "");
  processId = Option.String("--process-id", "");
  instanceId = Option.String("--instance-id", "");
  installationId = Option.String("--installation-id", "");
  leaseOwner = Option.String("--lease-owner", "");
  runtimeVersion = Option.String("--runtime-version", "");
  idempotencyKey = Option.String("--idempotency-key", "");
  leaseSeconds = Option.String("--lease-seconds", "");
  clockSkewToleranceMs = Option.String("--clock-skew-tolerance-ms", "");
  reclaimGraceMs = Option.String("--reclaim-grace-ms", "");
  maxAttempts = Option.String("--max-attempts", "");

  async execute() {
    const {
      resolveFactoryTrackingIssueNumber,
      acquireFactoryDistributedLease,
      buildDeterministicLeaseHolderId,
      normalizeLeaseSeconds,
    } = await import("../../commands/factory-distributed-lease.ts");

    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;

    const resolvedTracking = resolveFactoryTrackingIssueNumber({
      repo,
      trackingIssueNumber: this.trackingIssue,
    });

    const holderId = this.holderId || buildDeterministicLeaseHolderId({
      hostId: this.hostId,
      processId: this.processId,
      factoryId: this.factoryId,
      leaseName: this.leaseName,
    });

    if (!resolvedTracking.ok) {
      this.context.stdout.write(JSON.stringify({
        ok: false,
        lease_acquired: "false",
        lease_reason: String(resolvedTracking.reason || "tracking_issue_not_found"),
        lease_error: "",
        lease_tracking_issue_number: "",
        lease_factory_id: this.factoryId,
        lease_name: this.leaseName,
        lease_run_id: this.runId,
        lease_holder_id: holderId,
        lease_expires_at: "",
        lease_version: "0",
        lease_comment_id: "",
        lease_comment_etag: "",
      }));
      return 0;
    }

    const out = acquireFactoryDistributedLease({
      repo,
      trackingIssueNumber: resolvedTracking.tracking_issue_number,
      factoryId: this.factoryId,
      leaseName: this.leaseName,
      runId: this.runId,
      holderId,
      instanceId: this.instanceId || this.factoryId,
      installationId: this.installationId,
      hostId: this.hostId,
      leaseOwner: this.leaseOwner || holderId,
      runtimeVersion: this.runtimeVersion,
      idempotencyKey: this.idempotencyKey || `${this.factoryId}:${this.leaseName}:${this.runId}`,
      leaseSeconds: normalizeLeaseSeconds(this.leaseSeconds, 600),
      clockSkewToleranceMs: parseNonNegativeNumber(this.clockSkewToleranceMs, 5000),
      reclaimGraceMs: parseNonNegativeNumber(this.reclaimGraceMs, 15000),
      maxAttempts: parsePositiveNumber(this.maxAttempts, 5),
    });

    this.context.stdout.write(JSON.stringify({
      ok: Boolean(out.ok),
      lease_acquired: out.acquired ? "true" : "false",
      lease_reason: String(out.reason || "lease_unknown"),
      lease_error: String(out.error || ""),
      lease_tracking_issue_number: String(out.tracking_issue_number || resolvedTracking.tracking_issue_number || ""),
      lease_factory_id: String(out.factory_id || this.factoryId),
      lease_name: String(out.lease_name || this.leaseName),
      lease_run_id: String(out.run_id || this.runId),
      lease_holder_id: String(out.holder_id || holderId),
      lease_expires_at: String(out?.lease?.expires_at || out?.lease?.lease_expires_at || ""),
      lease_version: String(out?.lease?.version || 0),
      lease_instance_id: String(out?.lease?.instance_id || ""),
      lease_installation_id: String(out?.lease?.installation_id || ""),
      lease_host_id: String(out?.lease?.host_id || ""),
      lease_owner: String(out?.lease?.lease_owner || ""),
      lease_ttl_sec: String(out?.lease?.lease_ttl_sec || ""),
      lease_runtime_version: String(out?.lease?.runtime_version || ""),
      lease_reason_detail: String(out?.reason_detail || ""),
      lease_comment_id: String(out.comment_id || ""),
      lease_comment_etag: String(out.comment_etag || ""),
      lease_incident_fingerprint: String(out?.incident_fingerprint || ""),
      lease_incident_packet_id: String(out?.incident_packet_id || ""),
      lease_incident_packet_path: String(out?.incident_packet_path || ""),
      lease_incident_packet_persisted: out?.incident_packet_persisted ? "true" : "false",
      lease_incident_packet_persist_error: String(out?.incident_packet_persist_error || ""),
      lease_ambiguity_evidence: out?.lease_ambiguity_evidence && typeof out.lease_ambiguity_evidence === "object"
        ? out.lease_ambiguity_evidence
        : null,
    }));
    return 0;
  }
}

export class FactoryLeaseReleaseCommand extends Command {
  static paths = [["factory", "lease-release"]];
  repo = Option.String("--repo", "");
  factoryId = Option.String("--factory-id", "mothership/factory_supervisor");
  leaseName = Option.String("--lease-name", "");
  runId = Option.String("--run-id", "");
  trackingIssue = Option.String("--tracking-issue", "");
  holderId = Option.String("--holder-id", "");
  hostId = Option.String("--host-id", "");
  processId = Option.String("--process-id", "");
  reason = Option.String("--reason", "released");
  force = Option.Boolean("--force", false);
  maxAttempts = Option.String("--max-attempts", "");

  async execute() {
    const {
      resolveFactoryTrackingIssueNumber,
      releaseFactoryDistributedLease,
      buildDeterministicLeaseHolderId,
    } = await import("../../commands/factory-distributed-lease.ts");

    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;

    const resolvedTracking = resolveFactoryTrackingIssueNumber({
      repo,
      trackingIssueNumber: this.trackingIssue,
    });

    const holderId = this.holderId || buildDeterministicLeaseHolderId({
      hostId: this.hostId,
      processId: this.processId,
      factoryId: this.factoryId,
      leaseName: this.leaseName,
    });

    if (!resolvedTracking.ok) {
      this.context.stdout.write(JSON.stringify({
        ok: false,
        lease_released: "false",
        lease_release_reason: String(resolvedTracking.reason || "tracking_issue_not_found"),
        lease_error: "",
        lease_tracking_issue_number: "",
        lease_factory_id: this.factoryId,
        lease_name: this.leaseName,
        lease_run_id: this.runId,
        lease_holder_id: holderId,
        lease_comment_id: "",
        lease_comment_etag: "",
      }));
      return 0;
    }

    const out = releaseFactoryDistributedLease({
      repo,
      trackingIssueNumber: resolvedTracking.tracking_issue_number,
      factoryId: this.factoryId,
      leaseName: this.leaseName,
      runId: this.runId,
      holderId,
      reason: this.reason,
      force: this.force,
      maxAttempts: parsePositiveNumber(this.maxAttempts, 5),
    });

    this.context.stdout.write(JSON.stringify({
      ok: Boolean(out.ok),
      lease_released: out.released ? "true" : "false",
      lease_release_reason: String(out.reason || "lease_release_unknown"),
      lease_error: String(out.error || ""),
      lease_tracking_issue_number: String(out.tracking_issue_number || resolvedTracking.tracking_issue_number || ""),
      lease_factory_id: String(out.factory_id || this.factoryId),
      lease_name: String(out.lease_name || this.leaseName),
      lease_run_id: String(out.run_id || this.runId),
      lease_holder_id: String(out.holder_id || holderId),
      lease_comment_id: String(out.comment_id || ""),
      lease_comment_etag: String(out.comment_etag || ""),
    }));
    return 0;
  }
}

export const factoryLeaseCommands = [
  FactoryResolveTrackingIssueCommand,
  FactoryLeaseAcquireCommand,
  FactoryLeaseReleaseCommand,
];
