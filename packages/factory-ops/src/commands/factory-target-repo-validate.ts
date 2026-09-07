import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ghJson } from "../lib/cli-helpers.ts";
import { resolveManagedFactoryLabelSet } from "../lib/factory-label-contract.ts";

const DEFAULT_INSTANCE_RELATIVE_PATH = ".hatch/instance.json";
const DEFAULT_ISSUE_TEMPLATES_DIR = "factories/brainstorm/issue_templates";

const EXPECTED_KIND_ID = "brainstorm";
const EXPECTED_MANAGED_KIND_ID = "example-notes";
const EXPECTED_TARGET_REPO = "example-org/example-notes";
const EXPECTED_CONTROL_PLANE_REPO = "recallnet/astrochicken";
const EXPECTED_WORKSPACE_MODE = "api_only";

const REQUIRED_DESTINATIONS = Object.freeze({
  goal_issues: Object.freeze({
    repo: EXPECTED_CONTROL_PLANE_REPO,
    labels: Object.freeze(["goal", "source:brainstorm"]),
  }),
  platform_incidents: Object.freeze({
    repo: EXPECTED_CONTROL_PLANE_REPO,
    labels: Object.freeze(["managed-factory-bug", "kind:brainstorm"]),
  }),
});

const trim = (value = "") => String(value ?? "").trim();
const asRecord = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const normalizeRepo = (value = "") => trim(value).toLowerCase();
const normalizeLabels = (value) => (Array.isArray(value) ? value.map((entry) => trim(entry)).filter(Boolean) : []);

function createCheck(id, ok, message, details = {}) {
  return {
    id,
    ok: Boolean(ok),
    message: trim(message),
    details,
  };
}

function readJsonFile(filePath = "") {
  try {
    return {
      ok: true,
      value: JSON.parse(readFileSync(filePath, "utf8")),
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      value: null,
      error: `invalid_json:${trim(error?.message || error || "parse_failed")}`,
    };
  }
}

function listFilesRecursive(rootDir = "") {
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile()) {
        files.push(absolutePath);
      }
    }
  }

  files.sort((left, right) => left.localeCompare(right, "en"));
  return files;
}

function resolveRequiredTemplateFiles(issueTemplatesDir = "") {
  if (!issueTemplatesDir || !existsSync(issueTemplatesDir) || !statSync(issueTemplatesDir).isDirectory()) {
    return {
      ok: false,
      error: `missing_issue_templates_contract_dir:${issueTemplatesDir || "(empty)"}`,
      required: [],
    };
  }

  const required = listFilesRecursive(issueTemplatesDir)
    .map((filePath) => path.relative(issueTemplatesDir, filePath))
    .filter((relativePath) => trim(relativePath));

  if (required.length === 0) {
    return {
      ok: false,
      error: `missing_issue_templates_contract_files:${issueTemplatesDir}`,
      required: [],
    };
  }

  return {
    ok: true,
    error: "",
    required,
  };
}

function validateInstanceContract({
  manifest = {},
  expectedKindId = EXPECTED_KIND_ID,
  expectedTargetRepo = EXPECTED_TARGET_REPO,
  expectedControlPlaneRepo = EXPECTED_CONTROL_PLANE_REPO,
  expectedWorkspaceMode = EXPECTED_WORKSPACE_MODE,
} = {}) {
  const record = asRecord(manifest);
  const targetRepo = asRecord(record.target_repo);
  const violations = [];

  if (!trim(record.instance_id)) {
    violations.push("missing_instance_id");
  }
  if (trim(record.kind_id) !== trim(expectedKindId)) {
    violations.push(`kind_id_mismatch:expected=${trim(expectedKindId)}:actual=${trim(record.kind_id) || "(missing)"}`);
  }
  if (normalizeRepo(targetRepo.full_name) !== normalizeRepo(expectedTargetRepo)) {
    violations.push(`target_repo_mismatch:expected=${normalizeRepo(expectedTargetRepo)}:actual=${normalizeRepo(targetRepo.full_name) || "(missing)"}`);
  }
  if (trim(record.workspace_mode) !== trim(expectedWorkspaceMode)) {
    violations.push(`workspace_mode_mismatch:expected=${trim(expectedWorkspaceMode)}:actual=${trim(record.workspace_mode) || "(missing)"}`);
  }
  if (normalizeRepo(record.control_plane_repo) !== normalizeRepo(expectedControlPlaneRepo)) {
    violations.push(`control_plane_repo_mismatch:expected=${normalizeRepo(expectedControlPlaneRepo)}:actual=${normalizeRepo(record.control_plane_repo) || "(missing)"}`);
  }

  return {
    ok: violations.length === 0,
    violations,
    instance_id: trim(record.instance_id),
    kind_id: trim(record.kind_id),
    target_repo_full_name: normalizeRepo(targetRepo.full_name),
    workspace_mode: trim(record.workspace_mode),
    control_plane_repo: normalizeRepo(record.control_plane_repo),
  };
}

function validateDestinationContract({
  manifest = {},
  expectedDestinations = REQUIRED_DESTINATIONS,
} = {}) {
  const destinations = asRecord(asRecord(manifest).destinations);
  const violations = [];

  for (const [routeKey, routeContract] of Object.entries(expectedDestinations)) {
    const route = asRecord(destinations[routeKey]);
    if (Object.keys(route).length === 0) {
      violations.push(`missing_destination_route:${routeKey}`);
      continue;
    }

    const actualRepo = normalizeRepo(route.repo);
    const expectedRepo = normalizeRepo(routeContract.repo);
    if (actualRepo !== expectedRepo) {
      violations.push(`destination_repo_mismatch:${routeKey}:expected=${expectedRepo}:actual=${actualRepo || "(missing)"}`);
    }

    const labels = normalizeLabels(route.labels);
    for (const requiredLabel of routeContract.labels) {
      if (!labels.includes(requiredLabel)) {
        violations.push(`destination_label_missing:${routeKey}:${requiredLabel}`);
      }
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    required_routes: Object.keys(expectedDestinations),
  };
}

function validateIssueTemplates({
  targetRepoPath = "",
  requiredTemplateFiles = [],
  sourceIssueTemplatesDir = "",
} = {}) {
  const issueTemplateRoot = path.resolve(targetRepoPath, ".github", "ISSUE_TEMPLATE");
  const missing = [];
  const mismatched = [];

  for (const relativePath of requiredTemplateFiles) {
    const targetPath = path.resolve(issueTemplateRoot, relativePath);
    if (!existsSync(targetPath)) {
      missing.push(relativePath);
      continue;
    }

    const sourcePath = path.resolve(sourceIssueTemplatesDir, relativePath);
    if (!existsSync(sourcePath)) {
      continue;
    }

    const sourceContent = String(readFileSync(sourcePath, "utf8"));
    const targetContent = String(readFileSync(targetPath, "utf8"));
    if (sourceContent !== targetContent) {
      mismatched.push(relativePath);
    }
  }

  return {
    ok: missing.length === 0 && mismatched.length === 0,
    missing,
    mismatched,
    issue_template_root: issueTemplateRoot,
    required_templates: [...requiredTemplateFiles],
  };
}

function validateManagedRepoLabels({
  kindId = EXPECTED_MANAGED_KIND_ID,
  targetRepo = EXPECTED_TARGET_REPO,
  controlPlaneRepo = EXPECTED_CONTROL_PLANE_REPO,
  scope = "home",
  ghJsonExec,
} = {}) {
  const normalizedScope = trim(scope).toLowerCase();
  if (normalizedScope !== "home" && normalizedScope !== "control_plane") {
    return {
      ok: false,
      scope: normalizedScope,
      kind_id: trim(kindId),
      repo: "",
      missing: [],
      mismatched: [],
      error: `unsupported_scope:${normalizedScope || "(empty)"}`,
    };
  }

  let labelSet;
  try {
    labelSet = resolveManagedFactoryLabelSet({ kindId, targetRepo, controlPlaneRepo });
  } catch (error) {
    return {
      ok: false,
      scope: normalizedScope,
      kind_id: trim(kindId),
      repo: "",
      missing: [],
      mismatched: [],
      error: String(error?.message || error || "managed_repo_label_validation_failed"),
    };
  }

  const repo = normalizedScope === "home" ? labelSet.target_repo : labelSet.control_plane_repo;
  const expected = normalizedScope === "home" ? labelSet.home_labels : labelSet.control_plane_labels;

  const execJson = typeof ghJsonExec === "function"
    ? ghJsonExec
    : (args) => ghJson(args, []);

  let repoLabels = [];
  try {
    repoLabels = execJson(["label", "list", "--repo", repo, "--limit", "200", "--json", "name,description,color"]);
  } catch (error) {
    return {
      ok: false,
      scope: normalizedScope,
      kind_id: labelSet.kind_id,
      repo,
      missing: [],
      mismatched: [],
      error: String(error?.message || error || "managed_repo_label_validation_failed"),
    };
  }

  const byName = new Map((Array.isArray(repoLabels) ? repoLabels : [])
    .map((label) => [trim(label?.name || ""), label]));

  const missing = [];
  const mismatched = [];
  for (const spec of expected) {
    const name = trim(spec?.name || "");
    const existing = byName.get(name);
    if (!existing) {
      missing.push(name);
      continue;
    }

    const actualDescription = String(existing?.description || "");
    const actualColor = String(existing?.color || "").toLowerCase();
    const expectedDescription = String(spec?.description || "");
    const expectedColor = String(spec?.color || "").toLowerCase();

    if (actualDescription !== expectedDescription || actualColor !== expectedColor) {
      mismatched.push({
        name,
        expected: { description: expectedDescription, color: spec?.color || "" },
        actual: { description: actualDescription, color: String(existing?.color || "") },
      });
    }
  }

  return {
    ok: missing.length === 0 && mismatched.length === 0,
    scope: normalizedScope,
    kind_id: labelSet.kind_id,
    repo,
    missing,
    mismatched,
    error: "",
  };
}

function validateManagedLabels({
  targetRepo = EXPECTED_TARGET_REPO,
  controlPlaneRepo = EXPECTED_CONTROL_PLANE_REPO,
  ghJsonExec,
} = {}) {
  const home = validateManagedRepoLabels({
    kindId: EXPECTED_MANAGED_KIND_ID,
    targetRepo,
    controlPlaneRepo,
    scope: "home",
    ghJsonExec,
  });

  const controlPlane = validateManagedRepoLabels({
    kindId: EXPECTED_MANAGED_KIND_ID,
    targetRepo,
    controlPlaneRepo,
    scope: "control_plane",
    ghJsonExec,
  });

  return {
    ok: home.ok && controlPlane.ok,
    home,
    control_plane: controlPlane,
  };
}

export function validateFactoryTargetRepo({
  targetRepo = "",
  repoRoot = process.cwd(),
  instancePath = "",
  issueTemplatesDir = "",
  expectedKindId = EXPECTED_KIND_ID,
  expectedTargetRepo = EXPECTED_TARGET_REPO,
  expectedControlPlaneRepo = EXPECTED_CONTROL_PLANE_REPO,
  expectedWorkspaceMode = EXPECTED_WORKSPACE_MODE,
  ghJsonExec,
} = {}) {
  const checks = [];
  const resolvedTargetRepo = path.resolve(trim(targetRepo || ""));

  if (!resolvedTargetRepo || !existsSync(resolvedTargetRepo) || !statSync(resolvedTargetRepo).isDirectory()) {
    const targetRepoCheck = createCheck(
      "target_repo_path",
      false,
      "home repo path missing or not a directory",
      { error: `missing_target_repo_tree:${resolvedTargetRepo || "(empty)"}` },
    );

    return {
      ok: false,
      error: "target_repo_validation_failed",
      target_repo_path: resolvedTargetRepo,
      instance_path: "",
      required_templates: [],
      checks: [targetRepoCheck],
      summary: {
        total: 1,
        passed: 0,
        failed: 1,
        failed_checks: [targetRepoCheck.id],
      },
    };
  }

  const resolvedRepoRoot = path.resolve(trim(repoRoot || process.cwd()));
  const resolvedInstancePath = path.isAbsolute(trim(instancePath || ""))
    ? path.resolve(trim(instancePath || ""))
    : path.resolve(resolvedTargetRepo, trim(instancePath || DEFAULT_INSTANCE_RELATIVE_PATH));

  const resolvedIssueTemplatesDir = path.resolve(
    resolvedRepoRoot,
    trim(issueTemplatesDir || DEFAULT_ISSUE_TEMPLATES_DIR),
  );

  const requiredTemplates = resolveRequiredTemplateFiles(resolvedIssueTemplatesDir);
  if (!requiredTemplates.ok) {
    checks.push(createCheck(
      "issue_templates_contract",
      false,
      "issue template contract source is missing",
      {
        error: requiredTemplates.error,
        issue_templates_source_dir: resolvedIssueTemplatesDir,
      },
    ));
  }

  if (!existsSync(resolvedInstancePath)) {
    checks.push(createCheck(
      "instance_manifest",
      false,
      "instance manifest file is missing",
      { error: `missing_instance_manifest:${resolvedInstancePath}` },
    ));
  } else {
    const parsed = readJsonFile(resolvedInstancePath);
    if (!parsed.ok) {
      checks.push(createCheck(
        "instance_manifest",
        false,
        "instance manifest JSON is invalid",
        { error: parsed.error },
      ));
    } else {
      const manifest = asRecord(parsed.value);

      checks.push(createCheck(
        "instance_manifest",
        true,
        "instance manifest file loaded",
        { path: resolvedInstancePath },
      ));

      const instanceContract = validateInstanceContract({
        manifest,
        expectedKindId,
        expectedTargetRepo,
        expectedControlPlaneRepo,
        expectedWorkspaceMode,
      });
      checks.push(createCheck(
        "instance_contract",
        instanceContract.ok,
        instanceContract.ok ? "instance contract is compliant" : "instance contract drift detected",
        {
          violations: instanceContract.violations,
          instance_id: instanceContract.instance_id,
          kind_id: instanceContract.kind_id,
          target_repo_full_name: instanceContract.target_repo_full_name,
          workspace_mode: instanceContract.workspace_mode,
          control_plane_repo: instanceContract.control_plane_repo,
        },
      ));

      const destinationContract = validateDestinationContract({
        manifest,
        expectedDestinations: REQUIRED_DESTINATIONS,
      });
      checks.push(createCheck(
        "destination_contract",
        destinationContract.ok,
        destinationContract.ok ? "destination contract is compliant" : "destination contract drift detected",
        {
          violations: destinationContract.violations,
          required_routes: destinationContract.required_routes,
        },
      ));
    }
  }

  if (requiredTemplates.ok) {
    const templateContract = validateIssueTemplates({
      targetRepoPath: resolvedTargetRepo,
      requiredTemplateFiles: requiredTemplates.required,
      sourceIssueTemplatesDir: resolvedIssueTemplatesDir,
    });

    checks.push(createCheck(
      "issue_templates_contract",
      templateContract.ok,
      templateContract.ok ? "issue templates are present and match contract" : "issue template drift detected",
      {
        missing_templates: templateContract.missing,
        mismatched_templates: templateContract.mismatched,
        required_templates: templateContract.required_templates,
        issue_template_root: templateContract.issue_template_root,
      },
    ));
  }

  const labels = validateManagedLabels({
    targetRepo: expectedTargetRepo,
    controlPlaneRepo: expectedControlPlaneRepo,
    ghJsonExec,
  });
  checks.push(createCheck(
    "labels_contract",
    labels.ok,
    labels.ok ? "managed label contract is compliant" : "managed label contract drift detected",
    {
      home: labels.home,
      control_plane: labels.control_plane,
    },
  ));

  const failedChecks = checks.filter((check) => !check.ok).map((check) => check.id);
  const ok = failedChecks.length === 0;

  return {
    ok,
    error: ok ? "" : "target_repo_validation_failed",
    target_repo_path: resolvedTargetRepo,
    instance_path: resolvedInstancePath,
    issue_templates_source_dir: resolvedIssueTemplatesDir,
    required_templates: requiredTemplates.required,
    expected: {
      kind_id: expectedKindId,
      target_repo: expectedTargetRepo,
      control_plane_repo: expectedControlPlaneRepo,
      workspace_mode: expectedWorkspaceMode,
      destinations: REQUIRED_DESTINATIONS,
    },
    checks,
    summary: {
      total: checks.length,
      passed: checks.length - failedChecks.length,
      failed: failedChecks.length,
      failed_checks: failedChecks,
    },
  };
}

export function formatFactoryTargetRepoValidationSummary(result = {}) {
  const checks = Array.isArray(result?.checks) ? result.checks : [];
  const summary = asRecord(result?.summary);
  const lines = [
    `factory target-repo validation: ${result?.ok ? "pass" : "fail"}`,
    `target_repo_path: ${trim(result?.target_repo_path) || "(unknown)"}`,
    `instance_path: ${trim(result?.instance_path) || "(unknown)"}`,
    `checks: passed=${Number(summary?.passed) || 0} failed=${Number(summary?.failed) || 0} total=${Number(summary?.total) || 0}`,
  ];

  for (const check of checks) {
    const status = check?.ok ? "PASS" : "FAIL";
    lines.push(`- [${status}] ${trim(check?.id)}: ${trim(check?.message) || "(no message)"}`);

    const violations = Array.isArray(check?.details?.violations) ? check.details.violations : [];
    if (violations.length > 0) {
      lines.push(`  violations: ${violations.join(", ")}`);
    }

    const missingTemplates = Array.isArray(check?.details?.missing_templates)
      ? check.details.missing_templates
      : [];
    if (missingTemplates.length > 0) {
      lines.push(`  missing_templates: ${missingTemplates.join(", ")}`);
    }

    const mismatchedTemplates = Array.isArray(check?.details?.mismatched_templates)
      ? check.details.mismatched_templates
      : [];
    if (mismatchedTemplates.length > 0) {
      lines.push(`  mismatched_templates: ${mismatchedTemplates.join(", ")}`);
    }

    if (!check?.ok && trim(check?.details?.error)) {
      lines.push(`  error: ${trim(check.details.error)}`);
    }
  }

  return lines.join("\n");
}

function parseArgv(argv = []) {
  const parsed = {
    targetRepo: "",
    repoRoot: process.cwd(),
    instancePath: "",
    issueTemplatesDir: "",
    summary: false,
  };

  const args = Array.isArray(argv) ? [...argv] : [];
  for (let index = 0; index < args.length; index += 1) {
    const entry = trim(args[index]);
    if (!entry) continue;

    if (entry === "--summary") {
      parsed.summary = true;
      continue;
    }

    if (!entry.startsWith("--")) continue;

    const separator = entry.indexOf("=");
    const hasInlineValue = separator >= 0;
    const key = hasInlineValue ? entry.slice(2, separator).trim() : entry.slice(2).trim();
    const value = hasInlineValue
      ? entry.slice(separator + 1).trim()
      : trim(args[index + 1]);

    if (!hasInlineValue && value && !value.startsWith("--")) {
      index += 1;
    }

    if (key === "target-repo") parsed.targetRepo = value;
    else if (key === "repo-root") parsed.repoRoot = value || process.cwd();
    else if (key === "instance-path") parsed.instancePath = value;
    else if (key === "issue-templates-dir") parsed.issueTemplatesDir = value;
  }

  return parsed;
}

async function main(argv = process.argv.slice(2)) {
  const flags = parseArgv(argv);
  const result = validateFactoryTargetRepo({
    targetRepo: flags.targetRepo,
    repoRoot: flags.repoRoot,
    instancePath: flags.instancePath,
    issueTemplatesDir: flags.issueTemplatesDir,
  });

  if (flags.summary) {
    process.stdout.write(`${formatFactoryTargetRepoValidationSummary(result)}\n`);
  } else {
    process.stdout.write(JSON.stringify(result));
  }

  process.exitCode = result.ok ? 0 : 1;
}

const isDirectRun = (() => {
  const currentFile = pathToFileURL(fileURLToPath(import.meta.url)).href;
  const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
  return currentFile === invoked;
})();

if (isDirectRun) {
  await main();
}
