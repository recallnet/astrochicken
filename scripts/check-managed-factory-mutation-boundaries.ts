#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseDot } from "./lib/hatch-dot-parser-wrapper.ts";

const TELEMETRY_PREFIX = "managed-factory-mutation-boundaries";

const LABEL_CONTRACT_PATH = "docs/contracts/factory-label-contract.json";
const INCIDENT_PACKET_PATH = "packages/factory-ops/src/lib/incident-packet.ts";
const SUPERVISOR_ARTIFACT_PATH = "packages/factory-ops/src/lib/command-owners/supervisor-artifact.ts";
const GOLDEN_MUTATION_VIOLATION_PATH = "scripts/test/golden/managed-boundary-violation.dot";

const REQUIRED_PACKET_FINGERPRINT_FIELDS = Object.freeze([
  "factory_id",
  "source_repo",
  "run_id",
  "observed_behavior",
  "expected_behavior",
  "remediation_attempts",
  "signature_hash",
]);

const REQUIRED_SUPERVISOR_ARTIFACT_CONTRACT_TOKENS = Object.freeze([
  "buildIncidentPacket({",
  "validateIncidentPacket(incidentPacket)",
  "factory_id: normalizedFactoryId",
  "source_repo: normalizedSourceRepo",
  "run_id: normalizedRunId",
  "signature_hash: signature",
  "incident_packet_contract_failed",
]);


const READ_ONLY_CONTROL_PLANE_HINTS = Object.freeze([
  "upstream-bug-gate",
  "state-snapshot",
  "open-bug-gate",
  "action-item-gate",
  "factory status",
  "factory tick-status",
  "issue view",
  "issue list",
]);

const MUTATION_HINTS = Object.freeze([
  "issue create",
  "issue edit",
  "issue close",
  "issue reopen",
  "issue comment",
  "pr create",
  "pr merge",
  "pr close",
  "pr reopen",
  "label create",
  "label edit",
  "label delete",
  "git push",
  "emit-bug",
  "create-issue",
  "publish-control-plane-manifest",
  "apply-rejected-upstream",
]);

const TARGET_REPO_ALLOWED_MUTATIONS = Object.freeze([
  "issue_edit",
  "issue_close",
  "issue_reopen",
]);

const DESTINATION_REQUIRED_LABELS = Object.freeze([
  "goal",
  "source:brainstorm",
]);

const REPO_TARGET_ROLES = Object.freeze([
  Object.freeze({
    role: "control_plane_repo",
    token: "${control_plane_repo}",
  }),
  Object.freeze({
    role: "target_repo",
    token: "${target_repo}",
  }),
]);

function trim(value = "") {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function listFactoryDirs(factoriesRoot) {
  if (!existsSync(factoriesRoot)) {
    return [];
  }

  return readdirSync(factoriesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("_"))
    .sort((left, right) => left.localeCompare(right, "en"));
}

function collectManagedKindsFromKindFiles({ repoRoot, diagnostics }) {
  const factoriesRoot = join(repoRoot, "factories");
  const kindIds = [];

  for (const factoryDirName of listFactoryDirs(factoriesRoot)) {
    const kindPath = join(factoriesRoot, factoryDirName, "kind.json");
    if (!existsSync(kindPath)) {
      continue;
    }

    let parsed;
    try {
      parsed = readJson(kindPath);
    } catch (error) {
      diagnostics.push(`invalid_json file=${kindPath} message=${String(error?.message || error)}`);
      continue;
    }

    if (!isPlainObject(parsed)) {
      diagnostics.push(`invalid_shape file=${kindPath} message=kind.json must be a JSON object`);
      continue;
    }

    const kindId = trim(parsed.kind_id);
    if (!kindId) {
      diagnostics.push(`missing_required_field file=${kindPath} field=kind_id`);
      continue;
    }

    if (kindId !== factoryDirName) {
      diagnostics.push(`kind_id_mismatch file=${kindPath} expected=${factoryDirName} actual=${kindId}`);
      continue;
    }

    kindIds.push(kindId);
  }

  return [...new Set(kindIds)].sort((left, right) => left.localeCompare(right, "en"));
}

function collectManagedFactoryIdsFromLegacyRegistry({ repoRoot, diagnostics }) {
  const registryPath = join(repoRoot, "factory-registry.json");
  if (!existsSync(registryPath)) {
    return [];
  }

  let parsed;
  try {
    parsed = readJson(registryPath);
  } catch (error) {
    diagnostics.push(`invalid_json file=${registryPath} message=${String(error?.message || error)}`);
    return [];
  }

  if (!isPlainObject(parsed) || !Array.isArray(parsed.factories)) {
    return [];
  }

  return [...new Set(parsed.factories
    .map((entry) => trim(entry?.id))
    .filter(Boolean)
    .filter((id) => id !== "mothership"))]
    .sort((left, right) => left.localeCompare(right, "en"));
}

function filterFactoryIdsByScope(ids = [], scopeFactoryIds = []) {
  if (!Array.isArray(scopeFactoryIds) || scopeFactoryIds.length === 0) {
    return [...ids];
  }

  const scope = new Set(scopeFactoryIds.map((value) => trim(value)).filter(Boolean));
  return ids.filter((id) => scope.has(id));
}

function resolveManagedFactoryScope({ repoRoot, diagnostics, requireKinds, scopeFactoryIds = [] }) {
  const kindIds = filterFactoryIdsByScope(
    collectManagedKindsFromKindFiles({ repoRoot, diagnostics }),
    scopeFactoryIds,
  );

  if (kindIds.length > 0) {
    return {
      managedFactoryIds: kindIds,
      managedKindIds: kindIds,
      kindSource: "kind_json",
    };
  }

  const legacyManagedFactoryIds = filterFactoryIdsByScope(
    collectManagedFactoryIdsFromLegacyRegistry({ repoRoot, diagnostics }),
    scopeFactoryIds,
  );

  if (legacyManagedFactoryIds.length > 0) {
    return {
      managedFactoryIds: legacyManagedFactoryIds,
      managedKindIds: [],
      kindSource: "legacy_registry",
    };
  }

  if (requireKinds) {
    diagnostics.push(`missing_managed_kind_definitions root=${join(repoRoot, "factories")}`);
  }

  return {
    managedFactoryIds: [],
    managedKindIds: [],
    kindSource: "none",
  };
}

function collectManagedGraphPaths({ repoRoot, managedFactoryIds }) {
  const graphs = [];
  for (const factoryId of managedFactoryIds) {
    const graphsRoot = join(repoRoot, "factories", factoryId, "graphs");
    if (!existsSync(graphsRoot)) {
      continue;
    }

    const graphFiles = readdirSync(graphsRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".dot"))
      .map((entry) => join(graphsRoot, entry.name))
      .sort((left, right) => left.localeCompare(right, "en"));

    for (const graphFile of graphFiles) {
      graphs.push(graphFile);
    }
  }

  return graphs;
}

function normalizeForMatch(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasRepoFlag(normalized = "", { flag = "", token = "" } = {}) {
  if (!flag || !token) return false;
  return normalized.includes(`${flag} '${token}'`)
    || normalized.includes(`${flag} "${token}"`)
    || normalized.includes(`${flag} ${token}`);
}

function collectRepoTargets(normalized = "") {
  const targets = [];

  for (const roleTarget of REPO_TARGET_ROLES) {
    if (hasRepoFlag(normalized, { flag: "--repo", token: roleTarget.token })) {
      targets.push({ role: roleTarget.role, targetType: "repo_flag" });
      continue;
    }

    if (roleTarget.role === "control_plane_repo"
      && hasRepoFlag(normalized, { flag: "--control-plane-repo", token: roleTarget.token })) {
      targets.push({ role: roleTarget.role, targetType: "control_plane_flag" });
      continue;
    }

    if (roleTarget.role === "control_plane_repo" && normalized.includes(roleTarget.token)) {
      targets.push({ role: roleTarget.role, targetType: "control_plane_context" });
      continue;
    }

    if (roleTarget.role === "target_repo" && normalized.includes(roleTarget.token)) {
      targets.push({ role: roleTarget.role, targetType: "target_repo_context" });
    }
  }

  return targets;
}

function classifyMutationOperation(normalized = "") {
  if (!normalized) return "";

  if (normalized.includes("issue create") || normalized.includes("create-issue") || normalized.includes("emit-bug")) {
    return "issue_create";
  }

  if (normalized.includes("issue edit")) return "issue_edit";
  if (normalized.includes("issue close")) return "issue_close";
  if (normalized.includes("issue reopen")) return "issue_reopen";
  if (normalized.includes("issue comment")) return "issue_comment";
  if (normalized.includes("pr create")) return "pr_create";
  if (normalized.includes("pr merge")) return "pr_merge";
  if (normalized.includes("pr close")) return "pr_close";
  if (normalized.includes("pr reopen")) return "pr_reopen";
  if (normalized.includes("label create")) return "label_create";
  if (normalized.includes("label edit")) return "label_edit";
  if (normalized.includes("label delete")) return "label_delete";
  if (normalized.includes("git push")) return "git_push";
  if (normalized.includes("publish-control-plane-manifest")) return "publish_control_plane_manifest";
  if (normalized.includes("apply-rejected-upstream")) return "apply_rejected_upstream";

  if (MUTATION_HINTS.some((hint) => normalized.includes(hint))) {
    return "mutation_hint";
  }

  return "";
}

function hasRequiredDestinationLabels(normalized = "") {
  return DESTINATION_REQUIRED_LABELS.every((label) => normalized.includes(label.toLowerCase()));
}

function classifyControlPlaneMutationBoundary({ normalized = "", mutationOperation = "", targetType = "" } = {}) {
  const hasReadOnlyHint = READ_ONLY_CONTROL_PLANE_HINTS.some((hint) => normalized.includes(hint));

  if (!mutationOperation) {
    if (hasReadOnlyHint) {
      return { ok: true, policy: "read_only_control_plane" };
    }

    if (targetType === "repo_flag") {
      return { ok: false, policy: "non_readonly_control_plane_repo_target" };
    }

    return { ok: true, policy: "control_plane_context_only" };
  }

  if (mutationOperation === "issue_create") {
    if (hasRequiredDestinationLabels(normalized)) {
      return { ok: true, policy: "destination_issue_create_with_required_labels" };
    }

    return { ok: false, policy: "destination_issue_create_missing_required_labels" };
  }

  return { ok: false, policy: `disallowed_control_plane_mutation:${mutationOperation}` };
}

function classifyTargetRepoMutationBoundary({ mutationOperation = "" } = {}) {
  if (!mutationOperation) {
    return { ok: true, policy: "target_repo_read_only" };
  }

  if (TARGET_REPO_ALLOWED_MUTATIONS.includes(mutationOperation)) {
    return { ok: true, policy: "allowed_target_repo_issue_status_mutation" };
  }

  return { ok: false, policy: `disallowed_target_repo_mutation:${mutationOperation}` };
}

function evaluateMutationBoundaryForAction({ normalized = "", mutationOperation = "", target = {} } = {}) {
  if (!target || typeof target !== "object") {
    return { ok: true, policy: "unknown_target" };
  }

  if (target.role === "control_plane_repo") {
    return classifyControlPlaneMutationBoundary({
      normalized,
      mutationOperation,
      targetType: target.targetType,
    });
  }

  if (target.role === "target_repo") {
    return classifyTargetRepoMutationBoundary({ mutationOperation });
  }

  return { ok: true, policy: "unsupported_target_role" };
}

function collectNodeActionClassifications({ attrValue = "" } = {}) {
  const normalized = normalizeForMatch(attrValue);
  const mutationOperation = classifyMutationOperation(normalized);
  const targets = collectRepoTargets(normalized);

  if (targets.length === 0) {
    return [];
  }

  return targets.map((target) => {
    const decision = evaluateMutationBoundaryForAction({
      normalized,
      mutationOperation,
      target,
    });

    return {
      target,
      mutationOperation,
      decision,
      normalized,
    };
  });
}

function resolveValidationPaths({ repoRoot = "" } = {}) {
  const normalizedRoot = resolve(repoRoot || process.cwd());
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const docsCandidate = join(normalizedRoot, "docs", "contracts", "factory-label-contract.json");
  const supervisorArtifactCandidate = join(normalizedRoot, SUPERVISOR_ARTIFACT_PATH);
  const incidentCandidate = join(normalizedRoot, "packages", "factory-ops", "src", "lib", "incident-packet.ts");

  const labelContractPath = existsSync(docsCandidate)
    ? docsCandidate
    : join(packageRoot, LABEL_CONTRACT_PATH);

  const supervisorArtifactPath = existsSync(supervisorArtifactCandidate)
    ? supervisorArtifactCandidate
    : join(packageRoot, SUPERVISOR_ARTIFACT_PATH);

  const incidentPacketPath = existsSync(incidentCandidate)
    ? incidentCandidate
    : join(packageRoot, INCIDENT_PACKET_PATH);

  return {
    labelContractPath,
    supervisorArtifactPath,
    incidentPacketPath,
  };
}

async function validateGraphMutationBoundaries({ graphPaths, diagnostics }) {
  for (const graphPath of graphPaths) {
    let source;
    try {
      source = readText(graphPath);
    } catch (error) {
      diagnostics.push(`unreadable_file file=${graphPath} message=${String(error?.message || error)}`);
      continue;
    }

    let parsed;
    try {
      parsed = await parseDot(source);
    } catch (error) {
      diagnostics.push(`invalid_dot file=${graphPath} message=${String(error?.message || error)}`);
      continue;
    }

    const nodes = Object.values(parsed?.nodes || {});
    for (const node of nodes) {
      const attrs = isPlainObject(node?.attrs) ? node.attrs : {};
      const attrEntries = Object.entries(attrs)
        .filter(([, value]) => typeof value === "string")
        .sort(([left], [right]) => left.localeCompare(right, "en"));

      for (const [attrName, attrValue] of attrEntries) {
        const classifications = collectNodeActionClassifications({ attrValue });
        if (classifications.length === 0) {
          continue;
        }

        for (const classification of classifications) {
          if (classification.decision.ok) {
            continue;
          }

          if (classification.target.role === "control_plane_repo") {
            diagnostics.push(
              `control_plane_mutation_detected file=${graphPath} node=${trim(node?.id)} attr=${attrName} operation=${classification.mutationOperation || "none"} policy=${classification.decision.policy}`,
            );
            continue;
          }

          diagnostics.push(
            `target_repo_mutation_detected file=${graphPath} node=${trim(node?.id)} attr=${attrName} operation=${classification.mutationOperation || "none"} policy=${classification.decision.policy}`,
          );
        }
      }
    }
  }
}

async function validateGoldenMutationViolationFixture({ repoRoot = "", diagnostics = [] } = {}) {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const fixturePathCandidates = [
    join(repoRoot, GOLDEN_MUTATION_VIOLATION_PATH),
    join(packageRoot, GOLDEN_MUTATION_VIOLATION_PATH),
  ];

  const fixturePath = fixturePathCandidates.find((candidate) => existsSync(candidate)) || "";
  if (!fixturePath) {
    diagnostics.push(`missing_file file=${fixturePathCandidates[0]}`);
    return;
  }

  const fixtureDiagnostics = [];
  await validateGraphMutationBoundaries({
    graphPaths: [fixturePath],
    diagnostics: fixtureDiagnostics,
  });

  if (fixtureDiagnostics.length === 0) {
    diagnostics.push(`missing_expected_golden_violation file=${fixturePath}`);
    return;
  }

  const hasControlPlaneViolation = fixtureDiagnostics
    .some((line) => line.includes("control_plane_mutation_detected") && line.includes("policy=disallowed_control_plane_mutation:git_push"));

  if (!hasControlPlaneViolation) {
    diagnostics.push(`unexpected_golden_violation_shape file=${fixturePath}`);
  }
}

function collectLabelNames(labelContract = {}) {
  if (!isPlainObject(labelContract) || !Array.isArray(labelContract.factories)) {
    return [];
  }

  const names = [];
  for (const factory of labelContract.factories) {
    if (!isPlainObject(factory) || !Array.isArray(factory.labels)) {
      continue;
    }
    for (const label of factory.labels) {
      const name = trim(label?.name);
      if (name) {
        names.push(name);
      }
    }
  }

  return [...new Set(names)].sort((left, right) => left.localeCompare(right, "en"));
}

function validateLabelContract({ contractPath = "", managedKindIds, diagnostics }) {
  if (!existsSync(contractPath)) {
    diagnostics.push(`missing_file file=${contractPath}`);
    return;
  }

  let parsed;
  try {
    parsed = readJson(contractPath);
  } catch (error) {
    diagnostics.push(`invalid_json file=${contractPath} message=${String(error?.message || error)}`);
    return;
  }

  const knownLabels = new Set(collectLabelNames(parsed));
  if (!knownLabels.has("managed-factory-bug")) {
    diagnostics.push(`missing_required_label file=${contractPath} label=managed-factory-bug`);
  }

  if (!knownLabels.has("incident-fingerprint")) {
    diagnostics.push(`missing_required_label file=${contractPath} label=incident-fingerprint`);
  }

  for (const kindId of managedKindIds) {
    const requiredLabel = `kind:${kindId}`;
    if (!knownLabels.has(requiredLabel)) {
      diagnostics.push(`missing_required_label file=${contractPath} label=${requiredLabel}`);
    }
  }
}

function extractStringArrayLiteral(source = "", constantName = "") {
  const matcher = new RegExp(`const\\s+${constantName}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "m");
  const match = matcher.exec(String(source || ""));
  if (!match) {
    return null;
  }

  const values = [];
  const stringRegex = /["']([^"'\\]*(?:\\.[^"'\\]*)*)["']/g;
  for (const token of (match[1] || "").matchAll(stringRegex)) {
    values.push(String(token[1] || ""));
  }
  return values;
}

function validateIncidentFingerprintContract({ incidentPacketPath = "", diagnostics }) {
  if (!existsSync(incidentPacketPath)) {
    diagnostics.push(`missing_file file=${incidentPacketPath}`);
    return;
  }

  const incidentPacketSource = readText(incidentPacketPath);
  const hardRequiredFields = extractStringArrayLiteral(incidentPacketSource, "HARD_REQUIRED_FIELDS");
  if (!Array.isArray(hardRequiredFields) || hardRequiredFields.length === 0) {
    diagnostics.push(`missing_required_constant file=${incidentPacketPath} constant=HARD_REQUIRED_FIELDS`);
    return;
  }

  const fields = new Set(hardRequiredFields);
  for (const field of REQUIRED_PACKET_FINGERPRINT_FIELDS) {
    if (!fields.has(field)) {
      diagnostics.push(`missing_fingerprint_field file=${incidentPacketPath} field=${field}`);
    }
  }
}

function validateSupervisorArtifactContract({ supervisorArtifactPath = "", diagnostics }) {
  if (!existsSync(supervisorArtifactPath)) {
    diagnostics.push(`missing_file file=${supervisorArtifactPath}`);
    return;
  }

  const source = readText(supervisorArtifactPath);
  for (const token of REQUIRED_SUPERVISOR_ARTIFACT_CONTRACT_TOKENS) {
    if (!source.includes(token)) {
      diagnostics.push(`missing_supervisor_contract_token file=${supervisorArtifactPath} token=${JSON.stringify(token)}`);
    }
  }
}

function buildTelemetry({ ok, diagnosticsCount, managedFactoryCount, managedKindCount, graphCount, kindSource }) {
  if (ok) {
    return `[${TELEMETRY_PREFIX}] result=ok managed_factory_count=${managedFactoryCount} managed_kind_count=${managedKindCount} graph_count=${graphCount} kind_source=${kindSource}`;
  }

  return `[${TELEMETRY_PREFIX}] result=fail diagnostics=${diagnosticsCount} managed_factory_count=${managedFactoryCount} managed_kind_count=${managedKindCount} graph_count=${graphCount} kind_source=${kindSource}`;
}

function resolveScopeFactoryIdsFromManifestsRoot(manifestsRoot = "") {
  const absoluteRoot = resolve(manifestsRoot || process.cwd());
  const normalized = absoluteRoot.replace(/\\/g, "/");
  const marker = "/factories/";
  const markerIndex = normalized.lastIndexOf(marker);

  if (markerIndex === -1) {
    return [];
  }

  const suffix = normalized.slice(markerIndex + marker.length);
  const [factoryId] = suffix.split("/");
  const normalizedFactoryId = trim(factoryId);
  if (!normalizedFactoryId) {
    return [];
  }

  return [normalizedFactoryId];
}

function resolveRepoRootFromManifestsRoot(manifestsRoot = "") {
  const absoluteRoot = resolve(manifestsRoot || process.cwd());

  if (existsSync(join(absoluteRoot, "factories"))) {
    return absoluteRoot;
  }

  const normalized = absoluteRoot.replace(/\\/g, "/");
  const marker = "/factories/";
  const markerIndex = normalized.lastIndexOf(marker);

  if (markerIndex >= 0) {
    const candidate = normalized.slice(0, markerIndex);
    if (candidate) {
      return resolve(candidate);
    }
  }

  return absoluteRoot;
}

export async function validateManagedFactoryMutationBoundaries({ manifestsRoot = process.cwd(), requireKinds = false } = {}) {
  const diagnostics = [];
  const resolvedManifestsRoot = resolve(manifestsRoot);
  const repoRoot = resolveRepoRootFromManifestsRoot(resolvedManifestsRoot);

  const scope = resolveManagedFactoryScope({
    repoRoot,
    diagnostics,
    requireKinds,
    scopeFactoryIds: resolveScopeFactoryIdsFromManifestsRoot(resolvedManifestsRoot),
  });

  const graphPaths = collectManagedGraphPaths({
    repoRoot,
    managedFactoryIds: scope.managedFactoryIds,
  });

  const validationPaths = resolveValidationPaths({ repoRoot });

  await validateGraphMutationBoundaries({
    graphPaths,
    diagnostics,
  });

  await validateGoldenMutationViolationFixture({
    repoRoot,
    diagnostics,
  });

  validateLabelContract({
    contractPath: validationPaths.labelContractPath,
    managedKindIds: scope.managedKindIds,
    diagnostics,
  });

  validateIncidentFingerprintContract({
    incidentPacketPath: validationPaths.incidentPacketPath,
    diagnostics,
  });

  validateSupervisorArtifactContract({
    supervisorArtifactPath: validationPaths.supervisorArtifactPath,
    diagnostics,
  });

  const sortedDiagnostics = [...diagnostics].sort((left, right) => left.localeCompare(right, "en"));
  const ok = sortedDiagnostics.length === 0;

  return {
    ok,
    manifestsRoot: resolvedManifestsRoot,
    diagnostics: sortedDiagnostics,
    managedFactoryCount: scope.managedFactoryIds.length,
    managedKindCount: scope.managedKindIds.length,
    graphCount: graphPaths.length,
    kindSource: scope.kindSource,
    telemetry: buildTelemetry({
      ok,
      diagnosticsCount: sortedDiagnostics.length,
      managedFactoryCount: scope.managedFactoryIds.length,
      managedKindCount: scope.managedKindIds.length,
      graphCount: graphPaths.length,
      kindSource: scope.kindSource,
    }),
  };
}

function parseArgs(argv) {
  const options = {
    manifestsRoot: process.cwd(),
    requireKinds: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--manifests") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--manifests requires a path");
      }
      options.manifestsRoot = resolve(value);
      index += 1;
      continue;
    }

    if (arg === "--require-kinds") {
      options.requireKinds = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function usage() {
  return "Usage: node scripts/check-managed-factory-mutation-boundaries.ts [--manifests <path>] [--require-kinds]";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const result = await validateManagedFactoryMutationBoundaries({
    manifestsRoot: options.manifestsRoot,
    requireKinds: options.requireKinds,
  });

  if (!result.ok) {
    for (const diagnostic of result.diagnostics) {
      process.stderr.write(`${diagnostic}\n`);
    }
    process.stderr.write(`${result.telemetry}\n`);
    process.exit(1);
    return;
  }

  process.stdout.write(`${result.telemetry}\n`);
}

const isEntryPoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isEntryPoint) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.stderr.write(`[${TELEMETRY_PREFIX}] result=fail diagnostics=1 managed_factory_count=0 managed_kind_count=0 graph_count=0 kind_source=none\n`);
    process.exit(1);
  });
}
