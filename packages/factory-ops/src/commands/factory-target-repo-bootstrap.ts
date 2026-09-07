import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { gh, trim } from "../lib/cli-helpers.ts";

const DEFAULT_TEMPLATE_PATH = "factories/brainstorm/instance.template.json";
const DEFAULT_ISSUE_TEMPLATES_DIR = "factories/brainstorm/issue_templates";
const DEFAULT_INSTANCE_RELATIVE_PATH = ".hatch/instance.json";
const DEFAULT_DESTINATION_REPO = "recallnet/astrochicken";
const DEFAULT_KIND_ID = "brainstorm";
const DEFAULT_WORKSPACE_MODE = "api_only";

const REQUIRED_INTAKE_LABELS = Object.freeze(["hatch:intake"]);
const REQUIRED_GOAL_LABELS = Object.freeze(["goal", "source:brainstorm"]);
const REQUIRED_DESTINATION_KEY = "goal_issues";

const TARGET_REPO_LABEL_SPECS = Object.freeze([
  Object.freeze({
    name: "goal",
    description: "High-level goal",
    color: "0E8A16",
  }),
  Object.freeze({
    name: "source:brainstorm",
    description: "Managed factory source marker for brainstorm intake",
    color: "5319E7",
  }),
  Object.freeze({
    name: "hatch:intake",
    description: "Managed factory intake item",
    color: "1D76DB",
  }),
]);

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeRepoFullName(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(normalized)) return "";
  return normalized;
}

function parseJsonFile(filePath, label = "json") {
  try {
    return {
      ok: true,
      error: "",
      value: JSON.parse(readFileSync(filePath, "utf8")),
    };
  } catch (error) {
    return {
      ok: false,
      error: `invalid_${label}:${String(error?.message || error || "parse_failed")}`,
      value: null,
    };
  }
}

function parseRepoFromRemoteUrl(raw = "") {
  const text = String(raw || "").trim();
  if (!text) return "";

  const sshMatch = text.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return normalizeRepoFullName(`${sshMatch[1]}/${sshMatch[2]}`);
  }

  const httpsMatch = text.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (httpsMatch) {
    return normalizeRepoFullName(`${httpsMatch[1]}/${httpsMatch[2]}`);
  }

  const sshUrlMatch = text.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshUrlMatch) {
    return normalizeRepoFullName(`${sshUrlMatch[1]}/${sshUrlMatch[2]}`);
  }

  return "";
}

function resolveTargetRepoFullName({
  targetRepoPath = "",
  fallback = "",
  gitExec = spawnSync,
} = {}) {
  const remote = gitExec("git", ["-C", targetRepoPath, "remote", "get-url", "origin"], { encoding: "utf8" });
  const fromRemote = parseRepoFromRemoteUrl(String(remote?.stdout || ""));
  if (fromRemote) return fromRemote;

  const repoName = String(path.basename(targetRepoPath || "") || "target-repo").trim().toLowerCase();
  const fromPath = normalizeRepoFullName(`example-org/${repoName}`);
  if (fromPath) return fromPath;

  const normalizedFallback = normalizeRepoFullName(fallback);
  if (normalizedFallback) return normalizedFallback;

  return "example-org/home-repo";
}

function deriveDeterministicInstanceId({ targetRepoFullName = "", kindId = DEFAULT_KIND_ID } = {}) {
  const token = `${targetRepoFullName}_${kindId}`
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `fac_${token || "MANAGED_FACTORY"}`;
}

function listFilesRecursive(rootDir = "") {
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      }
    }
  }

  files.sort((left, right) => left.localeCompare(right, "en"));
  return files;
}

function ensureDirectory(pathValue = "") {
  mkdirSync(pathValue, { recursive: true });
}

function buildLabelCreateArgs(repo = "", spec = {}) {
  return [
    "label",
    "create",
    String(spec?.name || "").trim(),
    "--repo",
    String(repo || "").trim(),
    "--description",
    String(spec?.description || "").trim(),
    "--color",
    String(spec?.color || "").trim(),
    "--force",
  ];
}

function applyContentOperation({ filePath = "", desiredContent = "", dryRun = false } = {}) {
  const exists = existsSync(filePath);
  const currentContent = exists ? String(readFileSync(filePath, "utf8")) : "";
  const needsWrite = currentContent !== desiredContent;
  const changeType = !needsWrite ? "noop" : (exists ? "update" : "create");

  if (needsWrite && !dryRun) {
    ensureDirectory(path.dirname(filePath));
    writeFileSync(filePath, desiredContent, "utf8");
  }

  return {
    path: filePath,
    change: changeType,
    changed: needsWrite,
    applied: needsWrite && !dryRun,
  };
}

function buildDesiredInstanceManifest({
  template = {},
  existing = {},
  targetRepoFullName = "",
  instanceId = "",
  kindId = DEFAULT_KIND_ID,
  controlPlaneRepo = DEFAULT_DESTINATION_REPO,
} = {}) {
  const templateRecord = asRecord(template);
  const existingRecord = asRecord(existing);

  const templateTargetRepo = asRecord(templateRecord.target_repo);
  const existingTargetRepo = asRecord(existingRecord.target_repo);
  const preservedRepoId = trim(existingTargetRepo.repo_id || "");
  const targetRepo = {
    ...templateTargetRepo,
    ...existingTargetRepo,
    provider: "github",
    full_name: targetRepoFullName,
  };
  if (preservedRepoId) {
    targetRepo.repo_id = preservedRepoId;
  } else {
    delete targetRepo.repo_id;
  }

  const intakeTemplate = asRecord(templateRecord.intake);
  const intakeExisting = asRecord(existingRecord.intake);
  const selectorTemplate = asRecord(intakeTemplate.issue_selector);
  const selectorExisting = asRecord(intakeExisting.issue_selector);

  const intake = {
    issue_selector: {
      ...selectorTemplate,
      ...selectorExisting,
      labels: [...REQUIRED_INTAKE_LABELS],
    },
  };

  const destinationsTemplate = asRecord(templateRecord.destinations);
  const destinationsExisting = asRecord(existingRecord.destinations);
  const goalTemplate = asRecord(destinationsTemplate[REQUIRED_DESTINATION_KEY]);
  const goalExisting = asRecord(destinationsExisting[REQUIRED_DESTINATION_KEY]);

  const destinations = {
    [REQUIRED_DESTINATION_KEY]: {
      ...goalTemplate,
      ...goalExisting,
      repo: controlPlaneRepo,
      labels: [...REQUIRED_GOAL_LABELS],
    },
  };

  return {
    ...templateRecord,
    ...existingRecord,
    instance_id: instanceId,
    kind_id: kindId,
    target_repo: targetRepo,
    control_plane_repo: controlPlaneRepo,
    workspace_mode: DEFAULT_WORKSPACE_MODE,
    intake,
    destinations,
  };
}

function validateTemplateContract(template = {}) {
  const record = asRecord(template);
  const templateKindId = trim(record.kind_id || "");
  if (templateKindId !== DEFAULT_KIND_ID) {
    return { ok: false, error: `template_kind_id_mismatch:expected=${DEFAULT_KIND_ID}:actual=${templateKindId || "(missing)"}` };
  }

  const intakeLabels = asRecord(record.intake).issue_selector;
  const labels = Array.isArray(asRecord(intakeLabels).labels)
    ? asRecord(intakeLabels).labels.map((entry) => trim(entry)).filter(Boolean)
    : [];
  if (!labels.includes("brainstorm")) {
    return { ok: false, error: "template_missing_brainstorm_intake_selector" };
  }

  const destinations = asRecord(record.destinations);
  const goalIssues = asRecord(destinations[REQUIRED_DESTINATION_KEY]);
  const destinationLabels = Array.isArray(goalIssues.labels)
    ? goalIssues.labels.map((entry) => trim(entry)).filter(Boolean)
    : [];
  if (!destinationLabels.includes("goal") || !destinationLabels.includes("source:brainstorm")) {
    return { ok: false, error: "template_missing_goal_destination_labels" };
  }

  return { ok: true, error: "" };
}

function provisionTargetRepoLabels({
  targetRepoFullName = "",
  dryRun = false,
  ghExec,
  authCheck,
} = {}) {
  const executor = typeof ghExec === "function" ? ghExec : gh;
  const checkAuth = typeof authCheck === "function"
    ? authCheck
    : (exec) => exec(["auth", "status"]);

  const operations = TARGET_REPO_LABEL_SPECS.map((spec) => ({
    repo: targetRepoFullName,
    label: spec.name,
    args: buildLabelCreateArgs(targetRepoFullName, spec),
  }));

  if (dryRun) {
    return {
      ok: true,
      operations: operations.map((operation) => ({
        ...operation,
        planned: true,
        ok: true,
        status: 0,
        stdout: "",
        stderr: "",
      })),
      error: "",
    };
  }

  const authResult = checkAuth(executor);
  const authStatus = authResult?.status ?? (authResult?.ok ? 0 : 1);
  if (authStatus !== 0) {
    return {
      ok: false,
      operations: [],
      error: "missing_github_auth",
      auth_stderr: String(authResult?.stderr || authResult?.stdout || "gh auth status failed"),
    };
  }

  const executed = operations.map((operation) => {
    const result = executor(operation.args);
    return {
      ...operation,
      planned: false,
      ok: result?.status === 0 || result?.ok === true,
      status: result?.status ?? (result?.ok ? 0 : 1),
      stdout: String(result?.stdout || ""),
      stderr: String(result?.stderr || ""),
    };
  });

  const ok = executed.every((operation) => operation.ok);
  return {
    ok,
    operations: executed,
    error: ok ? "" : "label_provision_failed",
  };
}

export function bootstrapFactoryTargetRepo({
  dryRun = false,
  instancePath = "",
  targetRepo = "",
  repoRoot = process.cwd(),
  templatePath = "",
  issueTemplatesDir = "",
  kindId = DEFAULT_KIND_ID,
  controlPlaneRepo = "",
  resolveTargetRepoNameFn,
  ghExec,
  authCheck,
  gitExec,
} = {}) {
  const targetRepoPath = path.resolve(trim(targetRepo || ""));
  if (!targetRepoPath || !existsSync(targetRepoPath) || !statSync(targetRepoPath).isDirectory()) {
    return {
      ok: false,
      dry_run: Boolean(dryRun),
      error: `missing_target_repo_tree:${targetRepoPath || "(empty)"}`,
      operations: [],
    };
  }

  const resolvedRepoRoot = path.resolve(trim(repoRoot || process.cwd()));
  const resolvedTemplatePath = path.resolve(
    resolvedRepoRoot,
    trim(templatePath || DEFAULT_TEMPLATE_PATH),
  );
  if (!existsSync(resolvedTemplatePath)) {
    return {
      ok: false,
      dry_run: Boolean(dryRun),
      error: `missing_instance_template:${resolvedTemplatePath}`,
      operations: [],
    };
  }

  const resolvedIssueTemplatesDir = path.resolve(
    resolvedRepoRoot,
    trim(issueTemplatesDir || DEFAULT_ISSUE_TEMPLATES_DIR),
  );
  if (!existsSync(resolvedIssueTemplatesDir) || !statSync(resolvedIssueTemplatesDir).isDirectory()) {
    return {
      ok: false,
      dry_run: Boolean(dryRun),
      error: `missing_issue_templates_dir:${resolvedIssueTemplatesDir}`,
      operations: [],
    };
  }

  const templateRead = parseJsonFile(resolvedTemplatePath, "instance_template");
  if (!templateRead.ok) {
    return {
      ok: false,
      dry_run: Boolean(dryRun),
      error: templateRead.error,
      operations: [],
    };
  }

  const resolvedInstancePath = path.isAbsolute(trim(instancePath || ""))
    ? path.resolve(trim(instancePath || ""))
    : path.resolve(targetRepoPath, trim(instancePath || DEFAULT_INSTANCE_RELATIVE_PATH));

  const existingRead = existsSync(resolvedInstancePath)
    ? parseJsonFile(resolvedInstancePath, "instance_manifest")
    : { ok: true, error: "", value: {} };
  if (!existingRead.ok) {
    return {
      ok: false,
      dry_run: Boolean(dryRun),
      error: existingRead.error,
      operations: [],
    };
  }

  const templateRecord = asRecord(templateRead.value);
  const templateValidation = validateTemplateContract(templateRecord);
  if (!templateValidation.ok) {
    return {
      ok: false,
      dry_run: Boolean(dryRun),
      error: templateValidation.error,
      operations: [],
    };
  }

  const existingRecord = asRecord(existingRead.value);

  const fallbackTargetRepoName = trim(existingRecord?.target_repo?.full_name || templateRecord?.target_repo?.full_name || "");
  const resolveTargetRepoName = typeof resolveTargetRepoNameFn === "function"
    ? resolveTargetRepoNameFn
    : (args) => resolveTargetRepoFullName({ ...args, gitExec });

  const targetRepoFullName = normalizeRepoFullName(resolveTargetRepoName({
    targetRepoPath,
    fallback: fallbackTargetRepoName,
  }));

  const resolvedControlPlaneRepo = normalizeRepoFullName(
    trim(controlPlaneRepo || existingRecord.control_plane_repo || templateRecord.control_plane_repo || DEFAULT_DESTINATION_REPO),
  ) || DEFAULT_DESTINATION_REPO;

  const resolvedInstanceId = trim(existingRecord.instance_id)
    || deriveDeterministicInstanceId({ targetRepoFullName, kindId: trim(kindId || DEFAULT_KIND_ID) || DEFAULT_KIND_ID });

  const desiredInstance = buildDesiredInstanceManifest({
    template: templateRecord,
    existing: existingRecord,
    targetRepoFullName,
    instanceId: resolvedInstanceId,
    kindId: trim(kindId || DEFAULT_KIND_ID) || DEFAULT_KIND_ID,
    controlPlaneRepo: resolvedControlPlaneRepo,
  });

  const desiredInstanceContent = `${JSON.stringify(desiredInstance, null, 2)}\n`;

  const operations = [];

  const instanceOperation = applyContentOperation({
    filePath: resolvedInstancePath,
    desiredContent: desiredInstanceContent,
    dryRun: Boolean(dryRun),
  });
  operations.push({ type: "instance_manifest", ...instanceOperation });

  const sourceTemplateFiles = listFilesRecursive(resolvedIssueTemplatesDir);
  if (sourceTemplateFiles.length === 0) {
    return {
      ok: false,
      dry_run: Boolean(dryRun),
      error: `missing_issue_template_files:${resolvedIssueTemplatesDir}`,
      operations,
    };
  }

  const issueTemplateTargetRoot = path.resolve(targetRepoPath, ".github", "ISSUE_TEMPLATE");

  for (const sourcePath of sourceTemplateFiles) {
    const relativePath = path.relative(resolvedIssueTemplatesDir, sourcePath);
    const targetPath = path.resolve(issueTemplateTargetRoot, relativePath);
    const desiredContent = String(readFileSync(sourcePath, "utf8"));
    const templateOperation = applyContentOperation({
      filePath: targetPath,
      desiredContent,
      dryRun: Boolean(dryRun),
    });

    operations.push({
      type: "issue_template",
      source: sourcePath,
      relative_path: relativePath,
      ...templateOperation,
    });
  }

  const labels = provisionTargetRepoLabels({
    targetRepoFullName,
    dryRun: Boolean(dryRun),
    ghExec,
    authCheck,
  });

  const changedFiles = operations.filter((entry) => entry.changed).length;
  const appliedChanges = operations.filter((entry) => entry.applied).length;
  const idempotent = changedFiles === 0;

  const ok = labels.ok;
  return {
    ok,
    dry_run: Boolean(dryRun),
    error: ok ? "" : labels.error,
    target_repo_path: targetRepoPath,
    target_repo_full_name: targetRepoFullName,
    control_plane_repo: resolvedControlPlaneRepo,
    kind_id: desiredInstance.kind_id,
    instance_id: desiredInstance.instance_id,
    workspace_mode: desiredInstance.workspace_mode,
    template_path: resolvedTemplatePath,
    issue_templates_source_dir: resolvedIssueTemplatesDir,
    issue_templates_target_dir: issueTemplateTargetRoot,
    instance_path: resolvedInstancePath,
    operations,
    label_operations: labels.operations,
    changed_files: changedFiles,
    applied_changes: appliedChanges,
    idempotent,
  };
}

function parseArgv(argv = []) {
  const parsed = {
    dryRun: false,
    instancePath: "",
    targetRepo: "",
    templatePath: "",
    issueTemplatesDir: "",
    kindId: DEFAULT_KIND_ID,
    controlPlaneRepo: "",
    repoRoot: process.cwd(),
  };

  const args = Array.isArray(argv) ? [...argv] : [];
  for (let index = 0; index < args.length; index += 1) {
    const entry = String(args[index] || "").trim();
    if (!entry) continue;

    if (entry === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (!entry.startsWith("--")) continue;

    const idx = entry.indexOf("=");
    const hasInlineValue = idx >= 0;
    const key = hasInlineValue ? entry.slice(2, idx).trim() : entry.slice(2).trim();
    const value = hasInlineValue
      ? entry.slice(idx + 1).trim()
      : String(args[index + 1] || "").trim();

    if (!hasInlineValue && value && !value.startsWith("--")) {
      index += 1;
    }

    if (key === "instance-path") parsed.instancePath = value;
    else if (key === "target-repo") parsed.targetRepo = value;
    else if (key === "template-path") parsed.templatePath = value;
    else if (key === "issue-templates-dir") parsed.issueTemplatesDir = value;
    else if (key === "kind-id") parsed.kindId = value || DEFAULT_KIND_ID;
    else if (key === "control-plane-repo") parsed.controlPlaneRepo = value;
    else if (key === "repo-root") parsed.repoRoot = value || process.cwd();
  }

  return parsed;
}

async function main(argv = process.argv.slice(2)) {
  const flags = parseArgv(argv);
  const result = bootstrapFactoryTargetRepo({
    dryRun: flags.dryRun,
    instancePath: flags.instancePath,
    targetRepo: flags.targetRepo,
    templatePath: flags.templatePath,
    issueTemplatesDir: flags.issueTemplatesDir,
    kindId: flags.kindId,
    controlPlaneRepo: flags.controlPlaneRepo,
    repoRoot: flags.repoRoot,
  });
  process.stdout.write(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}

const isDirectRun = (() => {
  const current = pathToFileURL(fileURLToPath(import.meta.url)).href;
  const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
  return current === invoked;
})();

if (isDirectRun) {
  await main();
}
