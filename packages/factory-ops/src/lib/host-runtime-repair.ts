import path from "node:path";

import {
  findRegistryInstanceRow,
  loadFactoryRegistry,
  saveFactoryRegistry,
} from "./factory-registry.ts";
import { assignHostToInstance } from "../commands/factory-host-assignment.ts";

function trim(value = "") {
  return String(value || "").trim();
}

function parseEpochMs(value = "") {
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function resolveCanonicalRegistryPath(paths = {}) {
  return path.resolve(trim(paths.repoRoot || process.cwd()), "factory-registry.json");
}

export function syncHostRegistryFromCanonical({ paths = {}, env = process.env, installations = [] } = {}) {
  const hostRegistryPath = trim(env.HATCH_FACTORY_REGISTRY_PATH || "factory-registry.json");
  const hostRegistryCwd = trim(env.HATCH_FACTORY_REGISTRY_CWD || paths.repoRoot || process.cwd());
  const canonicalRegistryPath = resolveCanonicalRegistryPath(paths);
  const resolvedHostRegistryPath = path.isAbsolute(hostRegistryPath)
    ? hostRegistryPath
    : path.resolve(hostRegistryCwd, hostRegistryPath);

  if (resolvedHostRegistryPath === canonicalRegistryPath) {
    return { synced: false, hostRegistryPath: resolvedHostRegistryPath, canonicalRegistryPath };
  }

  let hostLoaded;
  let canonicalLoaded;
  try {
    hostLoaded = loadFactoryRegistry({ registryPath: hostRegistryPath, cwd: hostRegistryCwd });
    canonicalLoaded = loadFactoryRegistry({ registryPath: canonicalRegistryPath, cwd: paths.repoRoot || process.cwd() });
  } catch {
    return { synced: false, hostRegistryPath: resolvedHostRegistryPath, canonicalRegistryPath };
  }

  const installationByInstanceId = new Map(
    (Array.isArray(installations) ? installations : [])
      .map((installation) => [trim(installation?.instance_id), installation])
      .filter(([instanceId]) => Boolean(instanceId)),
  );

  let changed = false;
  const nextInstances = hostLoaded.registry.instances.map((row) => {
    const instanceId = trim(row?.instance_id);
    if (!instanceId) return row;
    const canonicalRow = findRegistryInstanceRow(canonicalLoaded.registry, instanceId);
    if (!canonicalRow) return row;

    const installation = installationByInstanceId.get(instanceId);
    const nextRow = {
      ...row,
      ...canonicalRow,
      assigned_host_id: trim(row?.assigned_host_id || canonicalRow?.assigned_host_id || "unassigned"),
      installation_manifest_path: trim(
        row?.installation_manifest_path
        || installation?.manifest_path
        || canonicalRow?.installation_manifest_path
        || "",
      ),
    };

    if (JSON.stringify(nextRow) !== JSON.stringify(row)) {
      changed = true;
    }
    return nextRow;
  });

  if (!changed) {
    return { synced: false, hostRegistryPath: hostLoaded.registryPath, canonicalRegistryPath };
  }

  saveFactoryRegistry({
    registryPath: hostLoaded.registryPath,
    registry: {
      ...hostLoaded.registry,
      instances: nextInstances,
    },
  });

  return { synced: true, hostRegistryPath: hostLoaded.registryPath, canonicalRegistryPath };
}

function shouldRepairInstallationAssignment({ installation = {}, registryRow = {}, nowMs = Date.now() } = {}) {
  const lease = installation?.lease;
  const assignedHostId = trim(registryRow?.assigned_host_id);
  const installationHostId = trim(installation?.host_id);

  if (!lease || typeof lease !== "object") return true;
  if (trim(lease.host_id) !== installationHostId) return true;

  const expiresAtMs = parseEpochMs(lease.lease_expires_at);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) return true;

  if (!assignedHostId || assignedHostId === "unassigned") return true;
  return false;
}

export function repairHostInstallationAssignments({ paths = {}, env = process.env, installations = [], now = Date.now() } = {}) {
  const registryPath = trim(env.HATCH_FACTORY_REGISTRY_PATH || "factory-registry.json");
  const registryCwd = trim(env.HATCH_FACTORY_REGISTRY_CWD || paths.repoRoot || process.cwd());

  let registryLoaded;
  try {
    registryLoaded = loadFactoryRegistry({ registryPath, cwd: registryCwd });
  } catch {
    return installations;
  }

  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const repaired = [];

  for (const installation of Array.isArray(installations) ? installations : []) {
    const instanceId = trim(installation?.instance_id);
    const manifestPath = trim(installation?.manifest_path);
    const registryRow = findRegistryInstanceRow(registryLoaded.registry, instanceId) || {};

    if (!instanceId || !manifestPath) {
      repaired.push(installation);
      continue;
    }

    if (!shouldRepairInstallationAssignment({ installation, registryRow, nowMs })) {
      repaired.push(installation);
      continue;
    }

    try {
      const assignment = assignHostToInstance({
        context: {
          instance_id: instanceId,
          host_id: trim(installation.host_id),
        },
        paths: {
          installationManifestPath: manifestPath,
        },
        hostId: trim(installation.host_id),
        instanceId,
        installationManifestPath: manifestPath,
        registryPath,
        now: nowMs,
      });

      repaired.push({
        ...installation,
        lease: assignment.lease,
      });

      registryLoaded = loadFactoryRegistry({ registryPath, cwd: registryCwd });
    } catch {
      repaired.push(installation);
    }
  }

  return repaired;
}
