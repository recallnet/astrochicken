import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

import { trim } from "../lib/cli-helpers.ts";
import { runProvisioningDriftCheck } from "../lib/factory-provisioning-drift.ts";
import { loadFactoryRegistry } from "../lib/factory-registry.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

function resolvePathCandidates(pathValue = "", { baseDir = "" } = {}) {
  const candidate = trim(pathValue);
  if (!candidate) return [];
  if (candidate.startsWith("/")) return [candidate];

  const out = [];
  const normalizedBaseDir = trim(baseDir);
  if (normalizedBaseDir) out.push(resolve(normalizedBaseDir, candidate));
  out.push(resolve(process.cwd(), candidate));
  out.push(resolve(repoRoot, candidate));
  return Array.from(new Set(out));
}

function readJson(pathValue = "", { baseDir = "" } = {}) {
  const candidates = resolvePathCandidates(pathValue, { baseDir });
  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue;
    try {
      return JSON.parse(readFileSync(candidate, "utf8"));
    } catch {
      return {};
    }
  }
  return {};
}

function readInstallationManifest({ row = {}, targetRepoPath = "", registryRoot = "" } = {}) {
  const installationPath = trim(row.installation_manifest_path);
  if (!installationPath) return {};

  const candidates = [];
  if (registryRoot) candidates.push(resolve(registryRoot, installationPath));
  if (targetRepoPath) candidates.push(resolve(targetRepoPath, installationPath));

  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue;
    try {
      return JSON.parse(readFileSync(candidate, "utf8"));
    } catch {
      return {};
    }
  }

  return readJson(installationPath, { baseDir: targetRepoPath });
}

function computeManifestIdentityHash(manifest = {}) {
  const payload = {
    instance_id: trim(manifest?.instance_id),
    kind_id: trim(manifest?.kind_id),
    target_repo: trim(manifest?.target_repo?.full_name),
    control_plane_repo: trim(manifest?.control_plane_repo),
    workspace_mode: trim(manifest?.workspace_mode),
  };
  const stable = JSON.stringify(payload);
  return createHash("sha256").update(stable).digest("hex").slice(0, 12);
}

export function appendProvisioningDriftActionItems({
  normalizedFactoryId,
  repo,
  registryPath,
  appendActionItem,
  snapshotErrors,
} = {}) {
  const normalizedRegistryPath = trim(registryPath);
  if (!normalizedRegistryPath) return;

  let registry;
  let resolvedRegistryPath;
  try {
    const loaded = loadFactoryRegistry({ registryPath: normalizedRegistryPath, cwd: process.cwd() });
    registry = loaded.registry;
    resolvedRegistryPath = loaded.registryPath;
  } catch {
    return;
  }
  const registryRoot = dirname(resolvedRegistryPath);

  const instances = Array.isArray(registry?.instances) ? registry.instances : [];
  const activeInstances = instances
    .map((entry) => ({
      instance_id: trim(entry?.instance_id),
      status: trim(entry?.status).toLowerCase(),
    }))
    .filter((entry) => entry.instance_id && entry.status === "active")
    .map((entry) => entry.instance_id);

  if (activeInstances.length === 0) return;

  const targetRepoMapJsonPath = join(registryRoot, "target-repos.json");
  const labelsJsonPath = join(registryRoot, "labels.json");

  const driftReport = runProvisioningDriftCheck({
    all: true,
    registryPath: resolvedRegistryPath,
    repoRoot,
    targetRepoMapJsonPath: existsSync(targetRepoMapJsonPath) ? targetRepoMapJsonPath : "",
    labelsJsonPath: existsSync(labelsJsonPath) ? labelsJsonPath : "",
    cwd: process.cwd(),
  });

  if (!Array.isArray(driftReport?.entries)) return;

  for (const entry of driftReport.entries) {
    if (!entry?.drifted) continue;
    const instanceId = trim(entry.instance_id);
    if (!instanceId) continue;
    if (!activeInstances.includes(instanceId)) continue;
    if (normalizedFactoryId && normalizedFactoryId !== "mothership" && normalizedFactoryId !== instanceId) continue;

    const row = instances.find((item) => trim(item?.instance_id) === instanceId) || {};
    const targetRepoPath = trim(entry.target_repo_path);

    const installationManifest = readInstallationManifest({
      row,
      targetRepoPath,
      registryRoot,
    });

    const targetManifestPath = trim(entry.manifest_drift?.path || "");
    const fallbackTargetManifestPath = targetRepoPath ? join(targetRepoPath, ".hatch", "instance.json") : "";
    const targetManifest = targetManifestPath && !targetManifestPath.startsWith("/")
      ? readJson(targetManifestPath, { baseDir: targetRepoPath })
      : readJson(targetManifestPath || fallbackTargetManifestPath);

    appendActionItem({
      kind: "provisioning_drift",
      problem: `provisioning drift detected for ${instanceId}`,
      issue: 0,
      title: `Provisioning drift: ${instanceId}`,
      instance_id: instanceId,
      repo: trim(entry.repo || repo),
      host_id: trim(installationManifest.host_id || row.assigned_host_id || "unknown_host"),
      installation_id: trim(installationManifest.installation_id || "unknown_installation"),
      manifest_identity_hash: computeManifestIdentityHash(targetManifest),
      drift_details: {
        missing_labels: Array.isArray(entry.missing_labels) ? entry.missing_labels : [],
        label_mismatches: Array.isArray(entry.label_mismatches) ? entry.label_mismatches : [],
        template_errors: Array.isArray(entry.template_errors) ? entry.template_errors : [],
        manifest_drift: entry.manifest_drift || { drifted: false, change: "noop", path: "" },
        error_code: trim(entry.error_code),
      },
      suggested_action: `Run hatch-ops factory provision-repo --instance-id ${instanceId} then re-run hatch-ops factory provisioning-drift --instance-id ${instanceId}`,
    });
  }

  if (trim(driftReport?.error)) {
    snapshotErrors.push(`provisioning_drift_check_failed:${trim(driftReport.error)}`);
  }
}
