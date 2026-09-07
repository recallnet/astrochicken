import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { gh, ghJson, trim } from "./cli-helpers.ts";
import { FACTORY_OPS_ERROR_CODES, createFactoryOpsError } from "./error-catalog.ts";
import { resolveFactoryLabelContract } from "./factory-label-contract.ts";
import { writeAtomicJson } from "./file-ops.ts";

const DEFAULT_INSTANCE_RELATIVE_PATH = ".hatch/instance.json";

const KNOWN_HOME_LABEL_SPECS = Object.freeze({
  "hatch:intake": Object.freeze({
    name: "hatch:intake",
    description: "Managed factory intake item",
    color: "1D76DB",
  }),
  "hatch:queued": Object.freeze({
    name: "hatch:queued",
    description: "Managed factory work queued for planning",
    color: "5319E7",
  }),
  "hatch:in-progress": Object.freeze({
    name: "hatch:in-progress",
    description: "Managed factory work in progress",
    color: "FBCA04",
  }),
  "hatch:blocked": Object.freeze({
    name: "hatch:blocked",
    description: "Managed factory work blocked on dependency or policy",
    color: "D93F0B",
  }),
  "hatch:done": Object.freeze({
    name: "hatch:done",
    description: "Managed factory work completed",
    color: "0E8A16",
  }),
});

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeRepoFullName(value = "") {
  const normalized = trim(value).toLowerCase();
  if (!normalized) return "";
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(normalized)) return "";
  return normalized;
}

function parseRepoFromRemoteUrl(raw = "") {
  const value = trim(raw);
  if (!value) return "";

  const sshMatch = value.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) return normalizeRepoFullName(`${sshMatch[1]}/${sshMatch[2]}`);

  const httpsMatch = value.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (httpsMatch) return normalizeRepoFullName(`${httpsMatch[1]}/${httpsMatch[2]}`);

  const sshUrlMatch = value.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshUrlMatch) return normalizeRepoFullName(`${sshUrlMatch[1]}/${sshUrlMatch[2]}`);

  return "";
}

function listFilesRecursive(rootDir = "") {
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolutePath);
      if (entry.isFile()) files.push(absolutePath);
    }
  }

  files.sort((left, right) => left.localeCompare(right, "en"));
  return files;
}

function parseJsonFile(filePath = "") {
  const normalizedPath = path.resolve(trim(filePath));
  const raw = readFileSync(normalizedPath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_registry_missing,
      `invalid_json:${normalizedPath}:${String(error?.message || error || "parse_failed")}`,
    );
  }
}

function ensureDirectory(dirPath = "") {
  mkdirSync(path.resolve(dirPath), { recursive: true });
}

function readJsonIfExists(filePath = "") {
  const normalizedPath = path.resolve(trim(filePath));
  if (!existsSync(normalizedPath)) {
    return {
      exists: false,
      path: normalizedPath,
      value: {},
      raw: "",
    };
  }

  const raw = String(readFileSync(normalizedPath, "utf8"));
  try {
    return {
      exists: true,
      path: normalizedPath,
      value: JSON.parse(raw),
      raw,
    };
  } catch (error) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_manifest_invalid,
      `instance_manifest_invalid_json:${normalizedPath}:${String(error?.message || error || "parse_failed")}`,
    );
  }
}

function normalizeLabels(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((entry) => trim(entry)).filter(Boolean)));
}

function resolveKindLabelLookup(kindId = "") {
  try {
    const contract = resolveFactoryLabelContract(kindId);
    return new Map(contract.labels.map((entry) => [trim(entry?.name), entry]));
  } catch {
    return new Map();
  }
}

function resolveLabelSpec({ labelName = "", kindLabelLookup = new Map() } = {}) {
  const normalizedName = trim(labelName);
  if (!normalizedName) return null;

  const known = KNOWN_HOME_LABEL_SPECS[normalizedName];
  if (known) return known;

  const contractSpec = kindLabelLookup.get(normalizedName);
  if (contractSpec) {
    return {
      name: normalizedName,
      description: trim(contractSpec.description) || `Factory label: ${normalizedName}`,
      color: trim(contractSpec.color) || "5319E7",
    };
  }

  return {
    name: normalizedName,
    description: `Factory label: ${normalizedName}`,
    color: "5319E7",
  };
}

function buildLabelCreateArgs(repo = "", spec = {}) {
  return [
    "label",
    "create",
    trim(spec.name),
    "--repo",
    trim(repo),
    "--description",
    trim(spec.description),
    "--color",
    trim(spec.color),
    "--force",
  ];
}

function resolveIssueTemplateSourceDir({ repoRoot = process.cwd(), kindId = "", kind = {} } = {}) {
  const fromKind = trim(kind.issue_templates || kind.issue_templates_dir || "");
  const resolvedFromKind = fromKind ? path.resolve(repoRoot, fromKind) : "";
  const resolvedDefault = path.resolve(repoRoot, "factories", trim(kindId), "issue_templates");

  if (resolvedFromKind) {
    if (!existsSync(resolvedFromKind) || !statSync(resolvedFromKind).isDirectory()) {
      throw createFactoryOpsError(
        FACTORY_OPS_ERROR_CODES.host_assignment_registry_missing,
        `kind_issue_templates_missing:${resolvedFromKind}`,
      );
    }
    return resolvedFromKind;
  }

  if (existsSync(resolvedDefault) && statSync(resolvedDefault).isDirectory()) {
    return resolvedDefault;
  }

  return "";
}

function resolveDestinationsContract({ kindId = "", kind = {}, factoryConfig = {} } = {}) {
  const kindDestinations = asRecord(kind.destinations);
  const configDestinations = asRecord(factoryConfig.destinations);
  const supported = normalizeLabels(kind.supported_destinations);

  const merged = Object.keys(kindDestinations).length > 0 ? kindDestinations : configDestinations;

  if (supported.length > 0) {
    for (const key of supported) {
      const route = asRecord(merged[key]);
      if (Object.keys(route).length === 0) {
        throw createFactoryOpsError(
          FACTORY_OPS_ERROR_CODES.host_assignment_registry_missing,
          `destination_contract_missing:${kindId}:${key}`,
        );
      }
    }
  }

  const out = {};
  for (const [key, route] of Object.entries(merged)) {
    const destinationKey = trim(key);
    if (!destinationKey) continue;
    const routeRecord = asRecord(route);
    const repo = normalizeRepoFullName(routeRecord.repo);
    const labels = normalizeLabels(routeRecord.labels);
    if (!repo || labels.length === 0) continue;
    out[destinationKey] = { repo, labels };
  }

  return out;
}

function resolveControlPlaneRepo({ instanceRow = {}, factoryConfig = {}, destinations = {} } = {}) {
  const fromConfig = normalizeRepoFullName(factoryConfig.control_plane_repo);
  if (fromConfig) return fromConfig;

  const destinationRepos = Object.values(asRecord(destinations))
    .map((route) => normalizeRepoFullName(route?.repo))
    .filter(Boolean);
  if (destinationRepos.length > 0) return destinationRepos[0];

  const targetRepo = normalizeRepoFullName(instanceRow.target_repo);
  return targetRepo;
}

function applyContentOperation({
  filePath = "",
  desiredContent = "",
  dryRun = false,
  writeFileSyncFn = writeFileSync,
} = {}) {
  const normalizedPath = path.resolve(filePath);
  const fileExists = existsSync(normalizedPath);
  const currentContent = fileExists ? String(readFileSync(normalizedPath, "utf8")) : "";
  const changed = currentContent !== desiredContent;
  const change = !changed ? "noop" : (fileExists ? "update" : "create");

  if (changed && !dryRun) {
    ensureDirectory(path.dirname(normalizedPath));
    writeFileSyncFn(normalizedPath, desiredContent, "utf8");
  }

  return {
    path: normalizedPath,
    change,
    changed,
    applied: changed && !dryRun,
  };
}

function resolveIssueTemplateTargetRoot(targetRepoPath = "") {
  const lower = path.resolve(targetRepoPath, ".github", "issue_template");
  const upper = path.resolve(targetRepoPath, ".github", "ISSUE_TEMPLATE");

  if (existsSync(lower) && statSync(lower).isDirectory()) return lower;
  if (existsSync(upper) && statSync(upper).isDirectory()) return upper;
  return lower;
}

function readFactoryConfig({ repoRoot = process.cwd(), kindId = "" } = {}) {
  const configPath = path.resolve(repoRoot, "factories", trim(kindId), "factory.config.json");
  if (!existsSync(configPath)) return { path: configPath, value: {} };
  return { path: configPath, value: asRecord(parseJsonFile(configPath)) };
}

function readInstanceTemplate({ repoRoot = process.cwd(), kindId = "" } = {}) {
  const templatePath = path.resolve(repoRoot, "factories", trim(kindId), "instance.template.json");
  if (!existsSync(templatePath)) return { path: templatePath, value: {} };
  return { path: templatePath, value: asRecord(parseJsonFile(templatePath)) };
}

function buildDesiredManifest({
  instanceRow = {},
  kind = {},
  factoryConfig = {},
  instanceTemplate = {},
  existingManifest = {},
  destinationsContract = {},
} = {}) {
  const templateRecord = asRecord(instanceTemplate);
  const existingRecord = asRecord(existingManifest);

  const expectedInstanceId = trim(instanceRow.instance_id);
  const expectedKindId = trim(instanceRow.kind_id);
  const expectedTargetRepo = normalizeRepoFullName(instanceRow.target_repo);

  const requiredIntakeLabels = normalizeLabels(kind.required_labels);
  const controlPlaneRepo = resolveControlPlaneRepo({
    instanceRow,
    factoryConfig,
    destinations: destinationsContract,
  });

  const resolvedWorkspaceMode = trim(
    kind.default_workspace_mode
      || factoryConfig.workspace_mode
      || existingRecord.workspace_mode
      || templateRecord.workspace_mode,
  );

  const templateTargetRepo = asRecord(templateRecord.target_repo);
  const existingTargetRepo = asRecord(existingRecord.target_repo);
  const targetRepo = {
    ...templateTargetRepo,
    ...existingTargetRepo,
    provider: "github",
    full_name: expectedTargetRepo,
  };

  if (!trim(targetRepo.repo_id)) {
    delete targetRepo.repo_id;
  }

  const intakeTemplate = asRecord(templateRecord.intake);
  const intakeExisting = asRecord(existingRecord.intake);
  const selectorTemplate = asRecord(intakeTemplate.issue_selector);
  const selectorExisting = asRecord(intakeExisting.issue_selector);

  const intake = {
    ...intakeTemplate,
    ...intakeExisting,
    issue_selector: {
      ...selectorTemplate,
      ...selectorExisting,
      labels: requiredIntakeLabels,
    },
  };

  const destinationsTemplate = asRecord(templateRecord.destinations);
  const destinationsExisting = asRecord(existingRecord.destinations);
  const destinations = {};

  for (const [routeKey, routeContract] of Object.entries(destinationsContract)) {
    destinations[routeKey] = {
      ...asRecord(destinationsTemplate[routeKey]),
      ...asRecord(destinationsExisting[routeKey]),
      repo: normalizeRepoFullName(routeContract.repo),
      labels: normalizeLabels(routeContract.labels),
    };
  }

  return {
    ...templateRecord,
    ...existingRecord,
    instance_id: expectedInstanceId,
    kind_id: expectedKindId,
    target_repo: targetRepo,
    control_plane_repo: controlPlaneRepo,
    workspace_mode: resolvedWorkspaceMode,
    intake,
    destinations,
  };
}

function validateManifestIdentity({
  existingManifest = {},
  expectedInstanceId = "",
  expectedKindId = "",
  expectedTargetRepo = "",
} = {}) {
  const existingRecord = asRecord(existingManifest);
  if (Object.keys(existingRecord).length === 0) return;

  const actualInstanceId = trim(existingRecord.instance_id);
  if (actualInstanceId && actualInstanceId !== trim(expectedInstanceId)) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_manifest_mismatch,
      `instance_id_mismatch:expected=${trim(expectedInstanceId)}:actual=${actualInstanceId}`,
    );
  }

  const actualKindId = trim(existingRecord.kind_id);
  if (actualKindId && actualKindId !== trim(expectedKindId)) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_manifest_mismatch,
      `kind_id_mismatch:expected=${trim(expectedKindId)}:actual=${actualKindId}`,
    );
  }

  const actualTargetRepo = normalizeRepoFullName(existingRecord?.target_repo?.full_name || "");
  if (actualTargetRepo && actualTargetRepo !== normalizeRepoFullName(expectedTargetRepo)) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_manifest_mismatch,
      `target_repo_mismatch:expected=${normalizeRepoFullName(expectedTargetRepo)}:actual=${actualTargetRepo}`,
    );
  }
}

function resolveTargetRepoFromGit({ targetRepoPath = "", gitExec = spawnSync } = {}) {
  const result = gitExec("git", ["-C", targetRepoPath, "remote", "get-url", "origin"], { encoding: "utf8" });
  if (Number(result?.status) !== 0) return "";
  return parseRepoFromRemoteUrl(String(result?.stdout || ""));
}

function resolveKindContract({ repoRoot = process.cwd(), kindId = "" } = {}) {
  const normalizedKindId = trim(kindId);
  const kindPath = path.resolve(repoRoot, "factories", normalizedKindId, "kind.json");
  if (!existsSync(kindPath)) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_registry_missing,
      `kind_definition_missing:${kindPath}`,
    );
  }

  const kind = asRecord(parseJsonFile(kindPath));
  if (trim(kind.kind_id) && trim(kind.kind_id) !== normalizedKindId) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_registry_missing,
      `kind_id_mismatch:expected=${normalizedKindId}:actual=${trim(kind.kind_id)}`,
    );
  }

  const factoryConfig = readFactoryConfig({ repoRoot, kindId: normalizedKindId });
  const instanceTemplate = readInstanceTemplate({ repoRoot, kindId: normalizedKindId });
  const issueTemplatesDir = resolveIssueTemplateSourceDir({ repoRoot, kindId: normalizedKindId, kind });
  const destinations = resolveDestinationsContract({
    kindId: normalizedKindId,
    kind,
    factoryConfig: factoryConfig.value,
  });

  return {
    kindPath,
    kind,
    kindId: normalizedKindId,
    factoryConfigPath: factoryConfig.path,
    factoryConfig: factoryConfig.value,
    instanceTemplatePath: instanceTemplate.path,
    instanceTemplate: instanceTemplate.value,
    issueTemplatesDir,
    destinations,
  };
}

function buildLabelDiff({
  requiredLabels = [],
  existingLabels = [],
  targetRepo = "",
  kindId = "",
} = {}) {
  const kindLabelLookup = resolveKindLabelLookup(kindId);
  const byName = new Map((Array.isArray(existingLabels) ? existingLabels : [])
    .map((entry) => [trim(entry?.name), entry]));

  return normalizeLabels(requiredLabels).map((labelName) => {
    const spec = resolveLabelSpec({ labelName, kindLabelLookup });
    const current = byName.get(trim(spec?.name));

    if (!current) {
      return {
        scope: "target_repo",
        repo: targetRepo,
        name: spec.name,
        expected: { description: spec.description, color: spec.color },
        actual: null,
        change: "create",
        changed: true,
      };
    }

    const actualDescription = trim(current.description);
    const actualColor = trim(current.color).toLowerCase();
    const expectedDescription = trim(spec.description);
    const expectedColor = trim(spec.color).toLowerCase();
    const changed = actualDescription !== expectedDescription || actualColor !== expectedColor;

    return {
      scope: "target_repo",
      repo: targetRepo,
      name: spec.name,
      expected: { description: spec.description, color: spec.color },
      actual: {
        description: String(current.description || ""),
        color: String(current.color || ""),
      },
      change: changed ? "update" : "noop",
      changed,
    };
  });
}

function listRepoLabels({ repo = "", ghJsonExec } = {}) {
  const execJson = typeof ghJsonExec === "function"
    ? ghJsonExec
    : (args) => ghJson(args, []);

  try {
    return execJson(["label", "list", "--repo", repo, "--limit", "200", "--json", "name,description,color"]);
  } catch (error) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_registry_missing,
      `label_list_failed:${repo}:${String(error?.message || error || "unknown_error")}`,
    );
  }
}

function applyLabelDiff({ labelDiff = [], dryRun = false, ghExec, authCheck } = {}) {
  const executor = typeof ghExec === "function" ? ghExec : gh;
  const checkAuth = typeof authCheck === "function"
    ? authCheck
    : (exec) => exec(["auth", "status"]);

  if (dryRun) {
    return labelDiff.map((entry) => ({
      ...entry,
      applied: false,
      ok: true,
      status: 0,
      stdout: "",
      stderr: "",
    }));
  }

  const authResult = checkAuth(executor);
  const authStatus = authResult?.status ?? (authResult?.ok ? 0 : 1);
  if (authStatus !== 0) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_registry_missing,
      `missing_github_auth:${String(authResult?.stderr || authResult?.stdout || "gh auth status failed")}`,
    );
  }

  return labelDiff.map((entry) => {
    if (!entry.changed) {
      return {
        ...entry,
        applied: false,
        ok: true,
        status: 0,
        stdout: "",
        stderr: "",
      };
    }

    const args = buildLabelCreateArgs(entry.repo, {
      name: entry.name,
      description: entry.expected.description,
      color: entry.expected.color,
    });
    const result = executor(args);
    const ok = result?.status === 0 || result?.ok === true;
    if (!ok) {
      throw createFactoryOpsError(
        FACTORY_OPS_ERROR_CODES.host_assignment_registry_missing,
        `label_provision_failed:${entry.name}:${String(result?.stderr || result?.stdout || "gh_label_create_failed")}`,
      );
    }

    return {
      ...entry,
      applied: true,
      ok,
      status: result?.status ?? 0,
      stdout: String(result?.stdout || ""),
      stderr: String(result?.stderr || ""),
    };
  });
}

export function provisionFactoryProvisioningContract({
  repoRoot = process.cwd(),
  instanceRow = {},
  targetRepoPath = "",
  instanceRelativePath = DEFAULT_INSTANCE_RELATIVE_PATH,
  dryRun = false,
  ghExec,
  ghJsonExec,
  authCheck,
  gitExec = spawnSync,
  writeAtomicJsonFn = writeAtomicJson,
  writeFileSyncFn = writeFileSync,
} = {}) {
  const row = asRecord(instanceRow);
  const expectedInstanceId = trim(row.instance_id);
  const expectedKindId = trim(row.kind_id);
  const expectedTargetRepo = normalizeRepoFullName(row.target_repo);

  if (!expectedInstanceId) {
    throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.host_assignment_registry_row_missing, "instance_id_required");
  }
  if (!expectedKindId) {
    throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.host_assignment_registry_row_missing, "kind_id_required");
  }
  if (!expectedTargetRepo) {
    throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.host_assignment_registry_row_missing, "target_repo_required");
  }

  const normalizedRepoRoot = path.resolve(trim(repoRoot || process.cwd()));
  const normalizedTargetRepoPath = path.resolve(trim(targetRepoPath || process.cwd()));

  if (!existsSync(normalizedTargetRepoPath) || !statSync(normalizedTargetRepoPath).isDirectory()) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_manifest_missing,
      `missing_target_repo_tree:${normalizedTargetRepoPath}`,
    );
  }

  const gitRemoteRepo = resolveTargetRepoFromGit({ targetRepoPath: normalizedTargetRepoPath, gitExec });
  if (gitRemoteRepo && gitRemoteRepo !== expectedTargetRepo) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_manifest_mismatch,
      `target_repo_remote_mismatch:expected=${expectedTargetRepo}:actual=${gitRemoteRepo}`,
    );
  }

  const kindContract = resolveKindContract({ repoRoot: normalizedRepoRoot, kindId: expectedKindId });
  const instancePath = path.resolve(normalizedTargetRepoPath, trim(instanceRelativePath || DEFAULT_INSTANCE_RELATIVE_PATH));
  const existingManifest = readJsonIfExists(instancePath);

  const manifestTargetRepo = normalizeRepoFullName(existingManifest?.value?.target_repo?.full_name || "");
  if (!gitRemoteRepo && !manifestTargetRepo) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_manifest_missing,
      `target_repo_identity_unproven:${normalizedTargetRepoPath}`,
    );
  }

  validateManifestIdentity({
    existingManifest: existingManifest.value,
    expectedInstanceId,
    expectedKindId,
    expectedTargetRepo,
  });

  const desiredManifest = buildDesiredManifest({
    instanceRow: row,
    kind: kindContract.kind,
    factoryConfig: kindContract.factoryConfig,
    instanceTemplate: kindContract.instanceTemplate,
    existingManifest: existingManifest.value,
    destinationsContract: kindContract.destinations,
  });

  const desiredManifestContent = `${JSON.stringify(desiredManifest, null, 2)}\n`;

  const templateOperations = [];
  const templateFiles = kindContract.issueTemplatesDir ? listFilesRecursive(kindContract.issueTemplatesDir) : [];
  const issueTemplateTargetRoot = resolveIssueTemplateTargetRoot(normalizedTargetRepoPath);
  for (const sourcePath of templateFiles) {
    const relativePath = path.relative(kindContract.issueTemplatesDir, sourcePath);
    const targetPath = path.resolve(issueTemplateTargetRoot, relativePath);
    const desiredContent = String(readFileSync(sourcePath, "utf8"));
    const operation = applyContentOperation({
      filePath: targetPath,
      desiredContent,
      dryRun: true,
      writeFileSyncFn,
    });
    templateOperations.push({
      type: "issue_template",
      source: sourcePath,
      relative_path: relativePath,
      ...operation,
    });
  }

  const manifestDiff = applyContentOperation({
    filePath: instancePath,
    desiredContent: desiredManifestContent,
    dryRun: true,
    writeFileSyncFn,
  });

  const existingLabels = listRepoLabels({ repo: expectedTargetRepo, ghJsonExec });
  const labelDiff = buildLabelDiff({
    requiredLabels: normalizeLabels(kindContract.kind.required_labels),
    existingLabels,
    targetRepo: expectedTargetRepo,
    kindId: expectedKindId,
  });

  const changedFiles = templateOperations.filter((entry) => entry.changed).length + (manifestDiff.changed ? 1 : 0);
  const changedLabels = labelDiff.filter((entry) => entry.changed).length;
  const changedTotal = changedFiles + changedLabels;

  const labelOperations = applyLabelDiff({
    labelDiff,
    dryRun: Boolean(dryRun),
    ghExec,
    authCheck,
  });

  let manifestOperation = {
    type: "instance_manifest",
    ...manifestDiff,
  };

  const appliedTemplateOperations = templateOperations.map((entry) => ({ ...entry }));

  if (!dryRun) {
    if (manifestDiff.changed) {
      ensureDirectory(path.dirname(instancePath));
      writeAtomicJsonFn(instancePath, desiredManifest);
      manifestOperation = {
        ...manifestOperation,
        applied: true,
      };
    }

    for (const operation of appliedTemplateOperations) {
      if (!operation.changed) continue;
      ensureDirectory(path.dirname(operation.path));
      const content = String(readFileSync(operation.source, "utf8"));
      writeFileSyncFn(operation.path, content, "utf8");
      operation.applied = true;
    }
  }

  return {
    ok: true,
    dry_run: Boolean(dryRun),
    status: changedTotal === 0
      ? "already_compliant"
      : (dryRun ? "dry_run" : "provisioned"),
    instance_id: expectedInstanceId,
    kind_id: expectedKindId,
    target_repo: expectedTargetRepo,
    target_repo_path: normalizedTargetRepoPath,
    instance_path: instancePath,
    kind_path: kindContract.kindPath,
    kind_context: {
      required_labels: normalizeLabels(kindContract.kind.required_labels),
      supported_destinations: normalizeLabels(kindContract.kind.supported_destinations),
      issue_templates_dir: kindContract.issueTemplatesDir,
      instance_template_path: kindContract.instanceTemplatePath,
      factory_config_path: kindContract.factoryConfigPath,
    },
    validations: {
      manifest_identity_match: true,
      target_repo_remote_match: !gitRemoteRepo || gitRemoteRepo === expectedTargetRepo,
      destination_contract_present: Object.keys(kindContract.destinations).length > 0,
    },
    destinations: kindContract.destinations,
    operations: {
      labels: labelOperations,
      instance_manifest: manifestOperation,
      issue_templates: appliedTemplateOperations,
    },
    changed_files: changedFiles,
    changed_labels: changedLabels,
    changed_total: changedTotal,
    applied_changes: dryRun ? 0 : changedTotal,
    idempotent: changedTotal === 0,
  };
}
