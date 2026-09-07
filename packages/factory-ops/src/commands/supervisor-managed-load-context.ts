import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parseJson, trim } from "../lib/cli-helpers.ts";

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readJsonFile(path) {
  const normalized = trim(path);
  if (!normalized) return { ok: false, error: "missing_path", value: null };
  if (!existsSync(normalized)) return { ok: false, error: `missing_file:${normalized}`, value: null };
  try {
    return {
      ok: true,
      error: "",
      value: JSON.parse(readFileSync(normalized, "utf8")),
    };
  } catch (error) {
    return {
      ok: false,
      error: `invalid_json:${normalized}:${String(error?.message || error || "unknown_error")}`,
      value: null,
    };
  }
}

function resolveKindPath({ kindPath = "", factoryRoot = "", kindId = "" } = {}) {
  if (trim(kindPath)) return trim(kindPath);
  if (trim(factoryRoot)) return join(trim(factoryRoot), "kind.json");
  if (trim(kindId)) return join("factories", trim(kindId), "kind.json");
  return "";
}

function resolveInstancePath({ instancePath = "", rootDir = process.cwd() } = {}) {
  if (trim(instancePath)) return trim(instancePath);
  return join(resolve(rootDir || process.cwd()), ".hatch", "instance.json");
}

function normalizeDestinations(destinations = {}) {
  const record = asRecord(destinations);
  return Object.fromEntries(
    Object.entries(record).filter(([key, value]) => trim(key) && value && typeof value === "object"),
  );
}

function normalizeManagedIntake(intake = {}) {
  const intakeRecord = asRecord(intake);
  const selector = asRecord(intakeRecord.issue_selector);
  const labels = Array.isArray(selector.labels)
    ? selector.labels.map((value) => trim(value)).filter(Boolean)
    : [];
  return {
    ...intakeRecord,
    issue_selector: {
      ...selector,
      labels: labels.length > 0 ? labels : ["goal", "ready"],
    },
  };
}

function buildConfigOnlyInstance({
  kindId = "",
  instanceId = "",
  targetRepo = "",
  controlPlaneRepo = "",
  destinationsJson = "",
} = {}) {
  return {
    kind_id: trim(kindId),
    instance_id: trim(instanceId),
    control_plane_repo: trim(controlPlaneRepo),
    target_repo: {
      full_name: trim(targetRepo),
    },
    destinations: normalizeDestinations(parseDestinations(destinationsJson)),
    intake: normalizeManagedIntake({}),
  };
}

function parseDestinations(destinationsJson = "") {
  const raw = trim(destinationsJson);
  if (!raw) return {};
  const parsed = parseJson(raw, {});
  return asRecord(parsed);
}

function buildFailureResult({
  factoryId = "",
  factoryRoot = "",
  kindPath = "",
  instancePath = "",
  kindId = "",
  instanceId = "",
  targetRepo = "",
  controlPlaneRepo = "",
  trustDomain = "",
  trustRole = "",
  error = "manifest_invalid",
} = {}) {
  return {
    manifest_ok: "false",
    manifest_error: trim(error) || "manifest_invalid",
    factory_id: trim(factoryId),
    factory_root: trim(factoryRoot),
    kind_path: trim(kindPath),
    instance_path: trim(instancePath),
    kind_id: trim(kindId),
    instance_id: trim(instanceId),
    target_repo: trim(targetRepo),
    control_plane_repo: trim(controlPlaneRepo),
    domain_graph: "",
    shared_supervisor_shell: "",
    destinations_json: JSON.stringify({}),
    intake_json: JSON.stringify({}),
    kind_context_json: JSON.stringify({}),
    trust_domain: trim(trustDomain),
    trust_role: trim(trustRole),
  };
}

export function loadManagedSupervisorContext({
  factoryId = "",
  factoryRoot = "",
  kindPath = "",
  instancePath = "",
  kindId = "",
  instanceId = "",
  targetRepo = "",
  controlPlaneRepo = "",
  destinationsJson = "",
  trustDomain = "",
  trustRole = "",
  rootDir = process.cwd(),
} = {}) {
  const resolvedKindPath = resolveKindPath({ kindPath, factoryRoot, kindId });
  const resolvedInstancePath = resolveInstancePath({ instancePath, rootDir });

  const kindRead = readJsonFile(resolvedKindPath);
  if (!kindRead.ok) {
    return buildFailureResult({
      factoryId,
      factoryRoot,
      kindPath: resolvedKindPath,
      instancePath: resolvedInstancePath,
      kindId,
      instanceId,
      targetRepo,
      controlPlaneRepo,
      trustDomain,
      trustRole,
      error: kindRead.error,
    });
  }

  const instanceRead = readJsonFile(resolvedInstancePath);
  const canSynthesizeConfigOnlyInstance = !instanceRead.ok
    && String(instanceRead.error || "").startsWith("missing_file:")
    && trim(kindId)
    && trim(instanceId)
    && trim(targetRepo)
    && trim(controlPlaneRepo);
  if (!instanceRead.ok && !canSynthesizeConfigOnlyInstance) {
    return buildFailureResult({
      factoryId,
      factoryRoot,
      kindPath: resolvedKindPath,
      instancePath: resolvedInstancePath,
      kindId,
      instanceId,
      targetRepo,
      controlPlaneRepo,
      trustDomain,
      trustRole,
      error: instanceRead.error,
    });
  }

  const kind = asRecord(kindRead.value);
  const instance = canSynthesizeConfigOnlyInstance
    ? buildConfigOnlyInstance({
        kindId,
        instanceId,
        targetRepo,
        controlPlaneRepo,
        destinationsJson,
      })
    : asRecord(instanceRead.value);

  const resolvedKindId = trim(kindId) || trim(kind.kind_id) || trim(instance.kind_id);
  const resolvedInstanceId = trim(instanceId) || trim(instance.instance_id);
  const resolvedFactoryId = trim(factoryId) || trim(resolvedKindId) || trim(resolvedInstanceId);

  const manifestKindId = trim(kind.kind_id);
  if (!manifestKindId) {
    return buildFailureResult({
      factoryId: resolvedFactoryId,
      factoryRoot,
      kindPath: resolvedKindPath,
      instancePath: resolvedInstancePath,
      kindId: resolvedKindId,
      instanceId: resolvedInstanceId,
      targetRepo,
      controlPlaneRepo,
      trustDomain,
      trustRole,
      error: "kind_missing_kind_id",
    });
  }

  if (resolvedKindId && manifestKindId && resolvedKindId !== manifestKindId) {
    return buildFailureResult({
      factoryId: resolvedFactoryId,
      factoryRoot,
      kindPath: resolvedKindPath,
      instancePath: resolvedInstancePath,
      kindId: resolvedKindId,
      instanceId: resolvedInstanceId,
      targetRepo,
      controlPlaneRepo,
      trustDomain,
      trustRole,
      error: `kind_id_mismatch:${resolvedKindId}!=${manifestKindId}`,
    });
  }

  const manifestInstanceKind = trim(instance.kind_id);
  if (!manifestInstanceKind) {
    return buildFailureResult({
      factoryId: resolvedFactoryId,
      factoryRoot,
      kindPath: resolvedKindPath,
      instancePath: resolvedInstancePath,
      kindId: resolvedKindId,
      instanceId: resolvedInstanceId,
      targetRepo,
      controlPlaneRepo,
      trustDomain,
      trustRole,
      error: "instance_missing_kind_id",
    });
  }

  if (manifestInstanceKind !== manifestKindId) {
    return buildFailureResult({
      factoryId: resolvedFactoryId,
      factoryRoot,
      kindPath: resolvedKindPath,
      instancePath: resolvedInstancePath,
      kindId: resolvedKindId,
      instanceId: resolvedInstanceId,
      targetRepo,
      controlPlaneRepo,
      trustDomain,
      trustRole,
      error: `instance_kind_mismatch:${manifestInstanceKind}!=${manifestKindId}`,
    });
  }

  const kindSchemaVersion = Number.parseInt(String(kind.schema_version ?? "").trim(), 10);
  if (!Number.isFinite(kindSchemaVersion) || kindSchemaVersion <= 0) {
    return buildFailureResult({
      factoryId: resolvedFactoryId,
      factoryRoot,
      kindPath: resolvedKindPath,
      instancePath: resolvedInstancePath,
      kindId: resolvedKindId,
      instanceId: resolvedInstanceId,
      targetRepo,
      controlPlaneRepo,
      trustDomain,
      trustRole,
      error: "kind_invalid_schema_version",
    });
  }

  if (kindSchemaVersion !== 1) {
    return buildFailureResult({
      factoryId: resolvedFactoryId,
      factoryRoot,
      kindPath: resolvedKindPath,
      instancePath: resolvedInstancePath,
      kindId: resolvedKindId,
      instanceId: resolvedInstanceId,
      targetRepo,
      controlPlaneRepo,
      trustDomain,
      trustRole,
      error: `kind_schema_version_unsupported:${kindSchemaVersion}`,
    });
  }

  if (kind.managed !== true) {
    return buildFailureResult({
      factoryId: resolvedFactoryId,
      factoryRoot,
      kindPath: resolvedKindPath,
      instancePath: resolvedInstancePath,
      kindId: resolvedKindId,
      instanceId: resolvedInstanceId,
      targetRepo,
      controlPlaneRepo,
      trustDomain,
      trustRole,
      error: "kind_not_managed",
    });
  }

  const domainGraph = trim(kind.domain_graph);
  const sharedSupervisorShell = trim(kind.shared_supervisor_shell);
  if (!domainGraph) {
    return buildFailureResult({
      factoryId: resolvedFactoryId,
      factoryRoot,
      kindPath: resolvedKindPath,
      instancePath: resolvedInstancePath,
      kindId: resolvedKindId,
      instanceId: resolvedInstanceId,
      targetRepo,
      controlPlaneRepo,
      trustDomain,
      trustRole,
      error: "kind_missing_domain_graph",
    });
  }

  if (!sharedSupervisorShell) {
    return buildFailureResult({
      factoryId: resolvedFactoryId,
      factoryRoot,
      kindPath: resolvedKindPath,
      instancePath: resolvedInstancePath,
      kindId: resolvedKindId,
      instanceId: resolvedInstanceId,
      targetRepo,
      controlPlaneRepo,
      trustDomain,
      trustRole,
      error: "kind_missing_shared_supervisor_shell",
    });
  }

  const instanceTargetRepo = trim(instance?.target_repo?.full_name || "");
  const resolvedTargetRepo = trim(targetRepo) || instanceTargetRepo;
  const resolvedControlPlaneRepo = trim(controlPlaneRepo) || trim(instance.control_plane_repo);

  const mergedDestinations = {
    ...normalizeDestinations(instance.destinations),
    ...normalizeDestinations(parseDestinations(destinationsJson)),
  };

  const intake = normalizeManagedIntake(instance.intake);
  const kindContext = {
    schema_version: kindSchemaVersion,
    managed: kind.managed === true,
    execution_mode: trim(kind.execution_mode),
    supported_destinations: Array.isArray(kind.supported_destinations)
      ? kind.supported_destinations.map((entry) => trim(entry)).filter(Boolean)
      : [],
    required_labels: Array.isArray(kind.required_labels)
      ? kind.required_labels.map((entry) => trim(entry)).filter(Boolean)
      : [],
    capabilities: Array.isArray(kind.capabilities) ? kind.capabilities : [],
  };

  return {
    manifest_ok: "true",
    manifest_error: "",
    factory_id: resolvedFactoryId,
    factory_root: trim(factoryRoot),
    kind_path: resolvedKindPath,
    instance_path: resolvedInstancePath,
    kind_id: manifestKindId,
    instance_id: resolvedInstanceId,
    target_repo: resolvedTargetRepo,
    control_plane_repo: resolvedControlPlaneRepo,
    domain_graph: domainGraph,
    shared_supervisor_shell: sharedSupervisorShell,
    destinations_json: JSON.stringify(mergedDestinations),
    intake_json: JSON.stringify(intake),
    kind_context_json: JSON.stringify(kindContext),
    trust_domain: trim(trustDomain),
    trust_role: trim(trustRole),
  };
}
