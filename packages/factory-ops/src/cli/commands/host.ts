import { Command, Option } from "clipanion";

import { parseBoolFlag, parseJsonObjectFlag, resolveB64OrRaw } from "../helpers.ts";

function writeJson(command, payload = {}) {
  command.context.stdout.write(JSON.stringify(payload));
}

function parseCsv(value = "") {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export class HostInstallRuntimeCommand extends Command {
  static paths = [["host", "install-runtime"]];
  hostBaseDir = Option.String("--host-base-dir", "");
  hostId = Option.String("--host-id", "");
  repoRoot = Option.String("--repo-root", ".");
  runtimePublicKeyPath = Option.String("--runtime-public-key-path", "");
  runtimeSignature = Option.String("--runtime-signature", "");
  runtimeSignatureKeyId = Option.String("--runtime-signature-key-id", "");
  runtimeReleaseManifestPath = Option.String("--runtime-release-manifest-path", "");
  runtimeSignedPayloadPath = Option.String("--runtime-signed-payload-path", "");

  async execute() {
    const { installHostRuntime, resolveHostRuntimePaths } = await import("../../commands/host-runtime-lifecycle.ts");
    const paths = resolveHostRuntimePaths({ hostBaseDir: this.hostBaseDir, repoRoot: this.repoRoot });
    const out = installHostRuntime({
      paths,
      hostId: this.hostId,
      repoRoot: this.repoRoot,
      runtimeSignature: this.runtimeSignature,
      runtimeSignatureKeyId: this.runtimeSignatureKeyId,
      trustPublicKeyPath: this.runtimePublicKeyPath,
      releaseManifestPath: this.runtimeReleaseManifestPath,
      signedPayloadPath: this.runtimeSignedPayloadPath,
    });
    writeJson(this, {
      ok: out.ok,
      status: out.status,
      message: out.message,
      error_code: out.errorCode,
      host_id: out.hostId,
      runtime_version: out.runtimeVersion,
      host_manifest_path: out.paths.hostManifestPath,
      runtime_entrypoint: out.manifest?.runtime_entrypoint || "",
      runtime_signature_status: out.manifest?.runtime_signature_status || "",
      runtime_signature_error: out.manifest?.runtime_signature_error || "",
      runtime_signature_hash: out.manifest?.runtime_signature_hash || "",
      runtime_signature_key_id: out.manifest?.runtime_signature_key_id || "",
      host_base_dir: out.paths.baseDir,
    });
    return out.ok ? 0 : 1;
  }
}

export class HostStatusCommand extends Command {
  static paths = [["host", "status"]];
  hostBaseDir = Option.String("--host-base-dir", "");
  repoRoot = Option.String("--repo-root", ".");
  runtimePublicKeyPath = Option.String("--runtime-public-key-path", "");
  runtimeSignature = Option.String("--runtime-signature", "");
  runtimeSignatureKeyId = Option.String("--runtime-signature-key-id", "");
  runtimeSignedPayloadPath = Option.String("--runtime-signed-payload-path", "");

  async execute() {
    const { getHostRuntimeStatus, resolveHostRuntimePaths } = await import("../../commands/host-runtime-lifecycle.ts");
    const paths = resolveHostRuntimePaths({ hostBaseDir: this.hostBaseDir, repoRoot: this.repoRoot });
    const out = getHostRuntimeStatus({
      paths,
      runtimeSignature: this.runtimeSignature,
      runtimeSignatureKeyId: this.runtimeSignatureKeyId,
      trustPublicKeyPath: this.runtimePublicKeyPath,
      signedPayloadPath: this.runtimeSignedPayloadPath,
    });
    writeJson(this, {
      ok: out.ok,
      status: out.status,
      message: out.message,
      error_code: out.errorCode,
      host_id: out.hostId,
      runtime_version: out.runtimeVersion,
      host_manifest_path: out.paths.hostManifestPath,
      installation_count: out.installationCount,
      installations: out.installations || [],
      diagnostics: out.diagnostics || [],
      lease_summary: out.leaseSummary || {
        assigned_host_id: "",
        lease_owner: "",
        lease_expires_at: "",
        lease_ttl_sec: "",
        runtime_version: "",
      },
      scheduler: out.scheduler || {},
      wakeup: out.wakeup || {},
      host_queue_depth: out.host_queue_depth ?? 0,
      host_active_slots: out.host_active_slots ?? 0,
      host_max_active_slots: out.host_max_active_slots ?? 0,
      host_capacity_pressure: out.host_capacity_pressure ?? 0,
      host_pending_installations: out.host_pending_installations ?? 0,
      wake_sources: out.wake_sources || [],
      runtime_signature_status: out.runtime_signature_status || "",
      runtime_signature_error: out.runtime_signature_error || "",
      runtime_signature_hash: out.runtime_signature_hash || "",
      runtime_signature_key_id: out.runtime_signature_key_id || "",
    });
    return out.ok ? 0 : 1;
  }
}

export class HostDoctorCommand extends Command {
  static paths = [["host", "doctor"]];
  hostBaseDir = Option.String("--host-base-dir", "");
  repoRoot = Option.String("--repo-root", ".");
  requiredEnv = Option.String("--required-env", "");
  runtimePublicKeyPath = Option.String("--runtime-public-key-path", "");
  runtimeSignature = Option.String("--runtime-signature", "");
  runtimeSignatureKeyId = Option.String("--runtime-signature-key-id", "");
  runtimeSignedPayloadPath = Option.String("--runtime-signed-payload-path", "");

  async execute() {
    const { doctorHostRuntime, resolveHostRuntimePaths } = await import("../../commands/host-runtime-lifecycle.ts");
    const paths = resolveHostRuntimePaths({ hostBaseDir: this.hostBaseDir, repoRoot: this.repoRoot });
    const out = doctorHostRuntime({
      paths,
      requiredEnv: parseCsv(this.requiredEnv),
      runtimeSignature: this.runtimeSignature,
      runtimeSignatureKeyId: this.runtimeSignatureKeyId,
      trustPublicKeyPath: this.runtimePublicKeyPath,
      signedPayloadPath: this.runtimeSignedPayloadPath,
    });
    writeJson(this, {
      ok: out.ok,
      status: out.status,
      message: out.message,
      error_code: out.errorCode,
      host_id: out.hostId,
      runtime_version: out.runtimeVersion,
      installation_count: out.installationCount,
      checks: out.checks,
      runtime_signature_status: out.runtimeSignatureStatus || "",
      runtime_signature_error: out.runtimeSignatureError || "",
    });
    return out.ok ? 0 : 1;
  }
}

export class HostRemoveRuntimeCommand extends Command {
  static paths = [["host", "remove-runtime"]];
  hostBaseDir = Option.String("--host-base-dir", "");
  repoRoot = Option.String("--repo-root", ".");
  force = Option.String("--force", "false");

  async execute() {
    const { removeHostRuntime, resolveHostRuntimePaths } = await import("../../commands/host-runtime-lifecycle.ts");
    const paths = resolveHostRuntimePaths({ hostBaseDir: this.hostBaseDir, repoRoot: this.repoRoot });
    const out = removeHostRuntime({ paths, force: parseBoolFlag(this.force, false) });
    writeJson(this, {
      ok: out.ok,
      status: out.status,
      message: out.message,
      error_code: out.errorCode,
      installation_count: out.installationCount,
    });
    return out.ok ? 0 : 1;
  }
}

export class HostRuntimeIntakeCertifyCommand extends Command {
  static paths = [["host", "runtime-intake-certify"]];
  repo = Option.String("--repo", "example-org/example-notes");
  issueNumber = Option.String("--issue-number", "");
  instanceId = Option.String("--instance-id", "brainstorm");
  targetRepo = Option.String("--target-repo", "example-org/example-notes");
  workspaceMode = Option.String("--workspace-mode", "api_only");
  hostBaseDir = Option.String("--host-base-dir", "");
  repoRoot = Option.String("--repo-root", ".");
  registryPath = Option.String("--registry-path", "");
  registryCwd = Option.String("--registry-cwd", "");
  destinationsJson = Option.String("--destinations-json", { required: false });
  destinationsJsonB64 = Option.String("--destinations-json-b64", { required: false });

  async execute() {
    const { certifyHostRuntimeIntake } = await import("../../commands/host-runtime-intake-certify.ts");

    const destinationsRaw = resolveB64OrRaw(
      this.destinationsJson,
      this.destinationsJsonB64,
      "destinations-json",
    );

    const parsedDestinations = parseJsonObjectFlag({
      raw: destinationsRaw,
      flagName: "destinations-json",
    });

    if (!parsedDestinations.ok) {
      this.context.stderr.write(`${parsedDestinations.error}\n`);
      return 2;
    }

    const out = await certifyHostRuntimeIntake({
      repo: this.repo,
      issueNumber: this.issueNumber,
      instanceId: this.instanceId,
      targetRepo: this.targetRepo,
      workspaceMode: this.workspaceMode,
      hostBaseDir: this.hostBaseDir,
      repoRoot: this.repoRoot,
      destinationsJson: destinationsRaw,
      registryPath: this.registryPath,
      registryCwd: this.registryCwd,
    });

    writeJson(this, out);
    return out.ok ? 0 : 1;
  }
}

export class HostRuntimeReleaseBuildCommand extends Command {
  static paths = [["host", "runtime-release", "build"]];

  version = Option.String("--version", "");
  channel = Option.String("--channel", "stable");
  releaseId = Option.String("--release-id", "");
  releaseTag = Option.String("--release-tag", "");
  releaseSha = Option.String("--release-sha", "");
  provenanceGitSha = Option.String("--provenance-git-sha", "");
  provenanceSourceRef = Option.String("--provenance-source-ref", "");
  buildTimestamp = Option.String("--build-timestamp", "");
  metadataTimestamp = Option.String("--metadata-timestamp", "");
  supportedKinds = Option.String("--supported-kinds", "");
  supportedPlatforms = Option.String("--supported-platforms", "");
  minFactoryOpsVersion = Option.String("--min-factory-ops-version", "");
  maxFactoryOpsVersion = Option.String("--max-factory-ops-version", "");
  artifactUrl = Option.String("--artifact-url", "");
  artifactChecksumSha256 = Option.String("--artifact-checksum-sha256", "");
  artifactSizeBytes = Option.String("--artifact-size-bytes", "");
  runtimeSignature = Option.String("--runtime-signature", "");
  runtimeSignatureKeyId = Option.String("--runtime-signature-key-id", "");
  runtimeSignatureAlgorithm = Option.String("--runtime-signature-algorithm", "sha256");
  runId = Option.String("--run-id", "");
  runsDir = Option.String("--runs-dir", ".hatch/runs");
  releasesDir = Option.String("--releases-dir", ".hatch/releases");
  outPath = Option.String("--out-path", "");
  repoRoot = Option.String("--repo-root", ".");

  async execute() {
    const { produceHostRuntimeReleaseManifest } = await import("../../commands/host-runtime-release-manifest.ts");
    try {
      const out = produceHostRuntimeReleaseManifest({
        version: this.version,
        channel: this.channel,
        releaseId: this.releaseId,
        releaseTag: this.releaseTag,
        releaseSha: this.releaseSha,
        provenanceGitSha: this.provenanceGitSha,
        provenanceSourceRef: this.provenanceSourceRef,
        buildTimestamp: this.buildTimestamp,
        metadataTimestamp: this.metadataTimestamp,
        supportedKindsCsv: this.supportedKinds,
        supportedPlatformsCsv: this.supportedPlatforms,
        minFactoryOpsVersion: this.minFactoryOpsVersion,
        maxFactoryOpsVersion: this.maxFactoryOpsVersion,
        artifactUrl: this.artifactUrl,
        artifactChecksumSha256: this.artifactChecksumSha256,
        artifactSizeBytes: this.artifactSizeBytes,
        runtimeSignature: this.runtimeSignature,
        runtimeSignatureKeyId: this.runtimeSignatureKeyId,
        runtimeSignatureAlgorithm: this.runtimeSignatureAlgorithm,
        runId: this.runId,
        runsDir: this.runsDir,
        releasesDir: this.releasesDir,
        outPath: this.outPath,
        repoRoot: this.repoRoot,
      });
      writeJson(this, out);
      return out.ok ? 0 : 1;
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      return 1;
    }
  }
}

export class HostRuntimeReleasePublishCommand extends Command {
  static paths = [["host", "runtime-release", "publish"]];

  repo = Option.String("--repo", "");
  version = Option.String("--version", "");
  channel = Option.String("--channel", "stable");
  releaseId = Option.String("--release-id", "");
  releaseTag = Option.String("--release-tag", "");
  releaseSha = Option.String("--release-sha", "");
  provenanceGitSha = Option.String("--provenance-git-sha", "");
  provenanceSourceRef = Option.String("--provenance-source-ref", "");
  buildTimestamp = Option.String("--build-timestamp", "");
  metadataTimestamp = Option.String("--metadata-timestamp", "");
  supportedKinds = Option.String("--supported-kinds", "");
  supportedPlatforms = Option.String("--supported-platforms", "");
  minFactoryOpsVersion = Option.String("--min-factory-ops-version", "");
  maxFactoryOpsVersion = Option.String("--max-factory-ops-version", "");
  artifactUrl = Option.String("--artifact-url", "");
  artifactChecksumSha256 = Option.String("--artifact-checksum-sha256", "");
  artifactSizeBytes = Option.String("--artifact-size-bytes", "");
  runtimeSignature = Option.String("--runtime-signature", "");
  runtimeSignatureKeyId = Option.String("--runtime-signature-key-id", "");
  runtimeSignatureAlgorithm = Option.String("--runtime-signature-algorithm", "sha256");
  runId = Option.String("--run-id", "");
  runsDir = Option.String("--runs-dir", ".hatch/runs");
  releasesDir = Option.String("--releases-dir", ".hatch/releases");
  outPath = Option.String("--out-path", "");
  repoRoot = Option.String("--repo-root", ".");

  async execute() {
    const { publishHostRuntimeReleaseManifest } = await import("../../commands/host-runtime-release-manifest.ts");
    if (!String(this.repo || "").trim()) {
      this.context.stderr.write("--repo is required\n");
      return 2;
    }

    try {
      const out = await publishHostRuntimeReleaseManifest({
        repo: this.repo,
        version: this.version,
        channel: this.channel,
        releaseId: this.releaseId,
        releaseTag: this.releaseTag,
        releaseSha: this.releaseSha,
        provenanceGitSha: this.provenanceGitSha,
        provenanceSourceRef: this.provenanceSourceRef,
        buildTimestamp: this.buildTimestamp,
        metadataTimestamp: this.metadataTimestamp,
        supportedKindsCsv: this.supportedKinds,
        supportedPlatformsCsv: this.supportedPlatforms,
        minFactoryOpsVersion: this.minFactoryOpsVersion,
        maxFactoryOpsVersion: this.maxFactoryOpsVersion,
        artifactUrl: this.artifactUrl,
        artifactChecksumSha256: this.artifactChecksumSha256,
        artifactSizeBytes: this.artifactSizeBytes,
        runtimeSignature: this.runtimeSignature,
        runtimeSignatureKeyId: this.runtimeSignatureKeyId,
        runtimeSignatureAlgorithm: this.runtimeSignatureAlgorithm,
        runId: this.runId,
        runsDir: this.runsDir,
        releasesDir: this.releasesDir,
        outPath: this.outPath,
        repoRoot: this.repoRoot,
      });
      writeJson(this, out);
      return out.ok ? 0 : 1;
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      return 1;
    }
  }
}

export const hostCommands = [
  HostInstallRuntimeCommand,
  HostStatusCommand,
  HostDoctorCommand,
  HostRemoveRuntimeCommand,
  HostRuntimeIntakeCertifyCommand,
  HostRuntimeReleaseBuildCommand,
  HostRuntimeReleasePublishCommand,
];
