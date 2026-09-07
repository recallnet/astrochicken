import { existsSync, readFileSync, statSync } from "node:fs";
import path, { dirname, resolve } from "node:path";

import { normalizeFactoryOpsError } from "./error-catalog.ts";
import {
  findRegistryInstanceRow,
  loadFactoryRegistry,
} from "./factory-registry.ts";
import { provisionFactoryRepo } from "../commands/factory-provision-repo.ts";

function trim(value = "") {
  return String(value ?? "").trim();
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeRepoFullName(value = "") {
  const normalized = trim(value).toLowerCase();
  if (!normalized) return "";
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/iu.test(normalized)) return "";
  return normalized;
}

function normalizeLabelsPayload(value) {
  if (Array.isArray(value)) return value;
  return [];
}

function loadJsonObjectFile(filePath = "", fallback = {}) {
  const normalizedPath = resolve(trim(filePath));
  const parsed = JSON.parse(readFileSync(normalizedPath, "utf8"));
  return {
    path: normalizedPath,
    value: asRecord(parsed) || fallback,
  };
}

function buildLabelsFetcher({ labelsByRepo = {}, labelsJsonPath = "" } = {}) {
  let fromFile = asRecord(labelsByRepo);

  const normalizedLabelsJsonPath = trim(labelsJsonPath);
  if (normalizedLabelsJsonPath) {
    const loaded = loadJsonObjectFile(normalizedLabelsJsonPath, {});
    fromFile = asRecord(loaded.value);
  }

  return (repo = "") => {
    const key = normalizeRepoFullName(repo);
    if (!key) return [];
    return normalizeLabelsPayload(fromFile[key]);
  };
}

function loadTargetRepoPathMap({ targetRepoPathMap = {}, targetRepoMapJsonPath = "" } = {}) {
  let fromFile = asRecord(targetRepoPathMap);
  let baseDir = process.cwd();

  const normalizedPath = trim(targetRepoMapJsonPath);
  if (normalizedPath) {
    const loaded = loadJsonObjectFile(normalizedPath, {});
    fromFile = asRecord(loaded.value);
    baseDir = dirname(loaded.path);
  }

  const normalized = {};
  for (const [key, value] of Object.entries(fromFile)) {
    const instanceId = trim(key);
    const candidatePath = trim(value);
    if (!instanceId || !candidatePath) continue;
    normalized[instanceId] = path.isAbsolute(candidatePath)
      ? resolve(candidatePath)
      : resolve(baseDir, candidatePath);
  }

  return normalized;
}

function findAncestorCandidates(startDir = "") {
  const candidates = [];
  let current = resolve(startDir || process.cwd());
  for (let index = 0; index < 12; index += 1) {
    candidates.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return candidates;
}

function parseManifestRepoIdentity(targetRepoPath = "", instancePath = ".hatch/instance.json") {
  const manifestPath = path.resolve(targetRepoPath, trim(instancePath || ".hatch/instance.json"));
  if (!existsSync(manifestPath)) return "";
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
    return normalizeRepoFullName(parsed?.target_repo?.full_name || "");
  } catch {
    return "";
  }
}

function resolveTargetRepoPath({
  expectedRepo = "",
  explicitTargetRepoPath = "",
  mappedTargetRepoPath = "",
  cwd = process.cwd(),
  registryPath = "",
  instancePath = ".hatch/instance.json",
} = {}) {
  const explicit = trim(explicitTargetRepoPath || mappedTargetRepoPath);
  if (explicit) {
    const resolved = resolve(explicit);
    if (existsSync(resolved) && statSync(resolved).isDirectory()) return resolved;
    return "";
  }

  const normalizedExpectedRepo = normalizeRepoFullName(expectedRepo);
  const repoName = normalizedExpectedRepo.includes("/")
    ? normalizedExpectedRepo.split("/")[1]
    : "";

  const startDirs = [
    resolve(trim(cwd || process.cwd())),
    resolve(dirname(trim(registryPath || cwd || process.cwd()))),
  ];

  for (const startDir of startDirs) {
    const ancestors = findAncestorCandidates(startDir);
    for (const ancestor of ancestors) {
      const siblingCandidate = repoName ? resolve(ancestor, repoName) : "";
      const directCandidates = [ancestor, siblingCandidate].filter(Boolean);
      for (const candidate of directCandidates) {
        if (!existsSync(candidate) || !statSync(candidate).isDirectory()) continue;

        const manifestRepo = parseManifestRepoIdentity(candidate, instancePath);
        if (manifestRepo && manifestRepo === normalizedExpectedRepo) {
          return candidate;
        }

        if (repoName && path.basename(candidate).toLowerCase() === repoName.toLowerCase()) {
          return candidate;
        }
      }
    }
  }

  return "";
}

function normalizeTemplateErrors(templateOperations = []) {
  const entries = Array.isArray(templateOperations) ? templateOperations : [];
  return entries
    .filter((entry) => Boolean(entry?.changed))
    .map((entry) => {
      const change = trim(entry?.change || "");
      const relativePath = trim(entry?.relative_path || "") || trim(entry?.path || "");
      return {
        path: relativePath,
        code: change === "create" ? "missing_template" : "mismatched_template",
        change,
      };
    });
}

function normalizeLabelDrift(labelOperations = []) {
  const entries = Array.isArray(labelOperations) ? labelOperations : [];
  const missing = [];
  const mismatched = [];

  for (const entry of entries) {
    if (!entry?.changed) continue;

    const labelName = trim(entry?.name || "");
    const change = trim(entry?.change || "");
    if (!labelName) continue;

    if (change === "create") {
      missing.push(labelName);
      continue;
    }

    mismatched.push({
      name: labelName,
      expected: asRecord(entry?.expected),
      actual: asRecord(entry?.actual),
      change,
    });
  }

  return {
    missing_labels: missing,
    label_mismatches: mismatched,
  };
}

function normalizeManifestDrift(manifestOperation = {}, instancePath = "") {
  const operation = asRecord(manifestOperation);
  const changed = Boolean(operation.changed);
  return {
    drifted: changed,
    change: trim(operation.change || (changed ? "update" : "noop")),
    path: trim(operation.path || instancePath),
  };
}

function buildFailureReport({
  instanceId = "",
  kindId = "",
  repo = "",
  targetRepoPath = "",
  errorCode = "",
  errorMessage = "",
} = {}) {
  return {
    schema: "factory.provisioning_drift.instance_report.v1",
    ok: false,
    drifted: true,
    instance_id: trim(instanceId),
    kind: trim(kindId),
    repo: normalizeRepoFullName(repo),
    target_repo_path: trim(targetRepoPath),
    missing_labels: [],
    label_mismatches: [],
    template_errors: [],
    manifest_drift: {
      drifted: true,
      change: "error",
      path: "",
    },
    error_code: trim(errorCode || "provisioning_drift_check_failed"),
    error: trim(errorMessage || "provisioning_drift_check_failed"),
    timestamp: new Date().toISOString(),
  };
}

function buildDriftReportFromProvision({ provisionResult = {}, targetRepoPath = "" } = {}) {
  const report = asRecord(provisionResult?.report);
  const operations = asRecord(report.operations);
  const labels = normalizeLabelDrift(operations.labels);
  const templateErrors = normalizeTemplateErrors(operations.issue_templates);
  const manifestDrift = normalizeManifestDrift(operations.instance_manifest, report.instance_path);

  const drifted = labels.missing_labels.length > 0
    || labels.label_mismatches.length > 0
    || templateErrors.length > 0
    || manifestDrift.drifted;

  return {
    schema: "factory.provisioning_drift.instance_report.v1",
    ok: true,
    drifted,
    instance_id: trim(provisionResult?.instance_id || report.instance_id),
    kind: trim(report.kind_id),
    repo: normalizeRepoFullName(report.target_repo),
    target_repo_path: trim(targetRepoPath || report.target_repo_path),
    missing_labels: labels.missing_labels,
    label_mismatches: labels.label_mismatches,
    template_errors: templateErrors,
    manifest_drift: manifestDrift,
    error_code: "",
    error: "",
    timestamp: new Date().toISOString(),
  };
}

export function checkProvisioningDriftForInstance({
  instanceId = "",
  registryPath = "factory-registry.json",
  repoRoot = process.cwd(),
  targetRepoPath = "",
  targetRepoPathMap = {},
  targetRepoMapJsonPath = "",
  labelsByRepo = {},
  labelsJsonPath = "",
  instancePath = ".hatch/instance.json",
  cwd = process.cwd(),
  loadFactoryRegistryFn = loadFactoryRegistry,
  findRegistryInstanceRowFn = findRegistryInstanceRow,
  provisionFactoryRepoFn = provisionFactoryRepo,
} = {}) {
  const normalizedInstanceId = trim(instanceId);
  if (!normalizedInstanceId) {
    return buildFailureReport({
      instanceId: normalizedInstanceId,
      errorCode: "missing_args",
      errorMessage: "instance_id_required",
    });
  }

  let loaded;
  try {
    loaded = loadFactoryRegistryFn({ registryPath, cwd });
  } catch (error) {
    const normalized = normalizeFactoryOpsError(error, "host_assignment_registry_missing");
    return buildFailureReport({
      instanceId: normalizedInstanceId,
      errorCode: normalized.code,
      errorMessage: normalized.message,
    });
  }

  const row = findRegistryInstanceRowFn(loaded.registry, normalizedInstanceId);
  if (!row) {
    return buildFailureReport({
      instanceId: normalizedInstanceId,
      errorCode: "host_assignment_registry_row_missing",
      errorMessage: `instance_not_registered:${normalizedInstanceId}`,
    });
  }

  const targetRepoMap = loadTargetRepoPathMap({
    targetRepoPathMap,
    targetRepoMapJsonPath,
  });

  const resolvedTargetRepoPath = resolveTargetRepoPath({
    expectedRepo: row.target_repo,
    explicitTargetRepoPath: targetRepoPath,
    mappedTargetRepoPath: targetRepoMap[normalizedInstanceId],
    cwd,
    registryPath: loaded.registryPath,
    instancePath,
  });

  if (!resolvedTargetRepoPath) {
    return buildFailureReport({
      instanceId: normalizedInstanceId,
      kindId: row.kind_id,
      repo: row.target_repo,
      errorCode: "host_assignment_manifest_missing",
      errorMessage: `target_repo_path_unresolved:${normalizeRepoFullName(row.target_repo)}:${normalizedInstanceId}`,
    });
  }

  const labelsFromMap = buildLabelsFetcher({ labelsByRepo, labelsJsonPath });
  const hasLabelFixture = trim(labelsJsonPath) || Object.keys(asRecord(labelsByRepo)).length > 0;

  let provisionResult;
  try {
    const provisionArgs = {
      instanceId: normalizedInstanceId,
      registryPath: loaded.registryPath,
      repoRoot,
      targetRepoPath: resolvedTargetRepoPath,
      instancePath,
      dryRun: true,
      cwd: resolve(cwd),
    };

    if (hasLabelFixture) {
      provisionArgs.ghJsonExec = (args) => {
        const repoIndex = Array.isArray(args) ? args.indexOf("--repo") : -1;
        const repo = repoIndex >= 0 ? trim(args[repoIndex + 1]) : "";
        if (!repo) return [];
        return labelsFromMap(repo);
      };
    }

    provisionResult = provisionFactoryRepoFn({
      ...provisionArgs,
      gitExec: () => ({ status: 1, stdout: "", stderr: "provisioning_drift_skip_git_remote" }),
    });
  } catch (error) {
    const normalized = normalizeFactoryOpsError(error, "host_assignment_manifest_missing");
    return buildFailureReport({
      instanceId: normalizedInstanceId,
      kindId: row.kind_id,
      repo: row.target_repo,
      targetRepoPath: resolvedTargetRepoPath,
      errorCode: normalized.code,
      errorMessage: normalized.message,
    });
  }

  return buildDriftReportFromProvision({
    provisionResult,
    targetRepoPath: resolvedTargetRepoPath,
  });
}

function collectRequestedInstanceIds({ instanceId = "", all = false, registry = {} } = {}) {
  const normalizedInstanceId = trim(instanceId);
  if (all) {
    const ids = (Array.isArray(registry?.instances) ? registry.instances : [])
      .map((entry) => trim(entry?.instance_id))
      .filter(Boolean);
    return Array.from(new Set(ids));
  }

  if (!normalizedInstanceId) {
    return [];
  }

  return [normalizedInstanceId];
}

export function runProvisioningDriftCheck({
  instanceId = "",
  all = false,
  registryPath = "factory-registry.json",
  repoRoot = process.cwd(),
  targetRepoPath = "",
  targetRepoPathMap = {},
  targetRepoMapJsonPath = "",
  labelsByRepo = {},
  labelsJsonPath = "",
  instancePath = ".hatch/instance.json",
  cwd = process.cwd(),
  loadFactoryRegistryFn = loadFactoryRegistry,
  checkProvisioningDriftForInstanceFn = checkProvisioningDriftForInstance,
} = {}) {
  let loaded;
  try {
    loaded = loadFactoryRegistryFn({ registryPath, cwd });
  } catch (error) {
    const normalized = normalizeFactoryOpsError(error, "host_assignment_registry_missing");
    return {
      schema: "factory.provisioning_drift.report.v1",
      ok: false,
      checked_count: 0,
      drifted_count: 0,
      registry_path: "",
      entries: [],
      error_code: normalized.code,
      error: normalized.message,
      timestamp: new Date().toISOString(),
    };
  }

  const requestedIds = collectRequestedInstanceIds({
    instanceId,
    all,
    registry: loaded.registry,
  });

  if (requestedIds.length === 0) {
    return {
      schema: "factory.provisioning_drift.report.v1",
      ok: false,
      checked_count: 0,
      drifted_count: 0,
      registry_path: loaded.registryPath,
      entries: [],
      error_code: "missing_args",
      error: "instance_id_required_or_all",
      timestamp: new Date().toISOString(),
    };
  }

  const entries = requestedIds.map((id) => checkProvisioningDriftForInstanceFn({
    instanceId: id,
    registryPath: loaded.registryPath,
    repoRoot,
    targetRepoPath,
    targetRepoPathMap,
    targetRepoMapJsonPath,
    labelsByRepo,
    labelsJsonPath,
    instancePath,
    cwd,
    loadFactoryRegistryFn,
    findRegistryInstanceRowFn: findRegistryInstanceRow,
    provisionFactoryRepoFn: provisionFactoryRepo,
  }));

  const driftedCount = entries.filter((entry) => Boolean(entry?.drifted)).length;
  const ok = entries.every((entry) => entry?.ok === true && entry?.drifted === false);

  return {
    schema: "factory.provisioning_drift.report.v1",
    ok,
    checked_count: entries.length,
    drifted_count: driftedCount,
    registry_path: loaded.registryPath,
    entries,
    error_code: "",
    error: "",
    timestamp: new Date().toISOString(),
  };
}

function summarizeInstanceDrift(entry = {}) {
  const issues = [];
  const missingLabels = Array.isArray(entry?.missing_labels) ? entry.missing_labels : [];
  const labelMismatches = Array.isArray(entry?.label_mismatches) ? entry.label_mismatches : [];
  const templateErrors = Array.isArray(entry?.template_errors) ? entry.template_errors : [];
  const manifestDrifted = Boolean(entry?.manifest_drift?.drifted);

  if (missingLabels.length > 0) {
    issues.push(`missing_labels=${missingLabels.join(",")}`);
  }
  if (labelMismatches.length > 0) {
    issues.push(`label_mismatches=${labelMismatches.map((item) => item.name).join(",")}`);
  }
  if (templateErrors.length > 0) {
    issues.push(`template_errors=${templateErrors.map((item) => `${item.code}:${item.path}`).join(",")}`);
  }
  if (manifestDrifted) {
    issues.push(`manifest_drift=${trim(entry?.manifest_drift?.change || "drifted")}`);
  }
  if (trim(entry?.error)) {
    issues.push(`error=${trim(entry.error)}`);
  }

  return issues.length > 0 ? issues.join("; ") : "compliant";
}

export function formatProvisioningDriftSummary(report = {}) {
  const entries = Array.isArray(report?.entries) ? report.entries : [];
  const lines = [
    `factory provisioning-drift: ${report?.ok ? "pass" : "fail"}`,
    `checked=${Number(report?.checked_count) || 0} drifted=${Number(report?.drifted_count) || 0}`,
    `registry_path=${trim(report?.registry_path) || "(unknown)"}`,
  ];

  for (const entry of entries) {
    const status = entry?.drifted ? "DRIFT" : "OK";
    const repo = trim(entry?.repo || "") || "(unknown_repo)";
    const instanceId = trim(entry?.instance_id || "") || "(unknown_instance)";
    lines.push(`- [${status}] ${instanceId} repo=${repo} ${summarizeInstanceDrift(entry)}`);
  }

  if (trim(report?.error)) {
    lines.push(`error=${trim(report.error)}`);
  }

  return lines.join("\n");
}
