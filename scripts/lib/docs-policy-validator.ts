import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DOCS_POLICY_VERSION_KEY = "docs_policy/v1";
export const DOCS_POLICY_RELATIVE_PATH = "docs/docs-policy.json";
export const DOCS_POLICY_SCHEMA_RELATIVE_PATH = "docs/docs-policy.schema.json";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");

const TOP_LEVEL_ALLOWED_KEYS = new Set([DOCS_POLICY_VERSION_KEY]);
const POLICY_ALLOWED_KEYS = new Set([
  "freshness",
  "frontmatter_exclude_globs",
  "in_scope_paths",
  "migration_debt",
  "orphan_exclude_globs",
  "ownership",
  "required_doc_types",
  "root_docs_allowlist",
  "root_level_exceptions",
]);
const FRESHNESS_ALLOWED_KEYS = new Set([
  "default_review_policy",
  "path_defaults",
  "review_policies",
]);
const REVIEW_POLICY_ALLOWED_KEYS = new Set(["id", "max_age_days", "mode"]);
const PATH_DEFAULT_ALLOWED_KEYS = new Set(["path", "review_policy"]);
const REQUIRED_DOC_TYPE_ALLOWED_KEYS = new Set(["doc_type", "path"]);
const OWNERSHIP_ALLOWED_KEYS = new Set(["canonical_roots", "owners", "root_doc_owner_id"]);
const OWNER_ALLOWED_KEYS = new Set(["display_name", "id"]);
const OWNERSHIP_ROOT_ALLOWED_KEYS = new Set(["owner_id", "path"]);
const MIGRATION_DEBT_ALLOWED_KEYS = new Set([
  "allow_missing_required_doc_types",
  "allow_unowned_in_scope_paths",
  "legacy_in_scope_allowlist",
  "max_legacy_in_scope_allowlist_entries",
]);

function createDiagnostic(code, path, message) {
  return { code, path, message };
}

function sortDiagnostics(diagnostics) {
  return [...diagnostics].sort((left, right) => {
    const leftKey = `${left.code}\u0000${left.path}\u0000${left.message}`;
    const rightKey = `${right.code}\u0000${right.path}\u0000${right.message}`;
    return leftKey.localeCompare(rightKey, "en");
  });
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertKnownKeys(record, allowedKeys, path, diagnostics) {
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      diagnostics.push(
        createDiagnostic("schema.unknown_key", `${path}.${key}`, `Unknown key '${key}' at ${path}.`),
      );
    }
  }
}

function assertType(predicate, value, code, path, message, diagnostics) {
  if (!predicate(value)) {
    diagnostics.push(createDiagnostic(code, path, message));
    return false;
  }
  return true;
}

function assertRequiredKeys(record, requiredKeys, path, diagnostics) {
  for (const key of requiredKeys) {
    if (!(key in record)) {
      diagnostics.push(
        createDiagnostic("schema.required_missing", `${path}.${key}`, `Missing required key '${key}' at ${path}.`),
      );
    }
  }
}

function assertStringArray(values, path, diagnostics) {
  if (!assertType(Array.isArray, values, "schema.type_mismatch", path, `${path} must be an array.`, diagnostics)) {
    return false;
  }

  let valid = true;
  for (const [index, value] of values.entries()) {
    if (typeof value !== "string") {
      diagnostics.push(
        createDiagnostic(
          "schema.type_mismatch",
          `${path}[${index}]`,
          `${path}[${index}] must be a string.`,
        ),
      );
      valid = false;
    }
  }

  return valid;
}

function isLexicographicallySorted(values) {
  const normalized = [...values].map(String);
  const sorted = [...normalized].sort();
  if (sorted.length !== normalized.length) {
    return false;
  }
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] !== sorted[index]) {
      return false;
    }
  }
  return true;
}

function assertNoDuplicateStrings(values, path, diagnostics, code = "schema.duplicate_value") {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      diagnostics.push(
        createDiagnostic(code, path, `Duplicate value '${value}' at ${path}.`),
      );
    }
    seen.add(value);
  }
}

function assertCanonicalStringArrayOrder(values, path, diagnostics) {
  if (!isLexicographicallySorted(values)) {
    diagnostics.push(
      createDiagnostic("ordering.non_canonical", path, `${path} must be lexicographically sorted.`),
    );
  }
}

function rootPathsConflict(left, right) {
  if (left === right) {
    return true;
  }

  const leftDir = left.endsWith("/");
  const rightDir = right.endsWith("/");

  if (leftDir && rightDir) {
    return left.startsWith(right) || right.startsWith(left);
  }

  if (leftDir) {
    return right.startsWith(left);
  }

  if (rightDir) {
    return left.startsWith(right);
  }

  return false;
}

function wildcardPatternToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function matchesDocsPolicyPattern(pathValue, pattern) {
  if (pattern === "*") {
    return true;
  }

  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return pathValue === prefix || pathValue.startsWith(`${prefix}/`);
  }

  if (pattern.includes("*")) {
    return wildcardPatternToRegex(pattern).test(pathValue);
  }

  return pathValue === pattern;
}

export function resolveDocsReviewPolicy(pathValue, policy) {
  const freshness = policy?.freshness;
  if (!freshness || !Array.isArray(freshness.path_defaults)) {
    return null;
  }

  let bestMatch = null;
  for (const entry of freshness.path_defaults) {
    if (entry && typeof entry.path === "string" && typeof entry.review_policy === "string" && matchesDocsPolicyPattern(pathValue, entry.path)) {
      if (!bestMatch || entry.path.length > bestMatch.path.length) {
        bestMatch = entry;
      }
    }
  }

  if (bestMatch) {
    return bestMatch.review_policy;
  }

  return typeof freshness.default_review_policy === "string" ? freshness.default_review_policy : null;
}

export function resolveDefaultDocsPolicyPath() {
  return join(REPO_ROOT, DOCS_POLICY_RELATIVE_PATH);
}

export function resolveDefaultDocsPolicySchemaPath() {
  return join(REPO_ROOT, DOCS_POLICY_SCHEMA_RELATIVE_PATH);
}

function readJsonFromPath(path) {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

export function loadDocsPolicyDocuments(options = {}) {
  const cwd = options.cwd ? resolve(options.cwd) : REPO_ROOT;
  const policyPath = options.policyPath
    ? resolve(cwd, options.policyPath)
    : resolve(cwd, DOCS_POLICY_RELATIVE_PATH);
  const schemaPath = options.schemaPath
    ? resolve(cwd, options.schemaPath)
    : resolve(cwd, DOCS_POLICY_SCHEMA_RELATIVE_PATH);

  const diagnostics = [];

  if (!existsSync(schemaPath)) {
    diagnostics.push(
      createDiagnostic("io.missing_file", "schema", `Schema file not found: ${schemaPath}`),
    );
  }

  if (!existsSync(policyPath)) {
    diagnostics.push(
      createDiagnostic("io.missing_file", "policy", `Policy file not found: ${policyPath}`),
    );
  }

  if (diagnostics.length > 0) {
    return {
      ok: false,
      schemaPath,
      policyPath,
      schemaDocument: null,
      policyDocument: null,
      diagnostics: sortDiagnostics(diagnostics),
    };
  }

  let schemaDocument;
  let policyDocument;

  try {
    schemaDocument = readJsonFromPath(schemaPath);
  } catch (error) {
    diagnostics.push(
      createDiagnostic("io.invalid_json", "schema", `Failed to parse JSON schema file: ${schemaPath} (${error.message})`),
    );
  }

  try {
    policyDocument = readJsonFromPath(policyPath);
  } catch (error) {
    diagnostics.push(
      createDiagnostic("io.invalid_json", "policy", `Failed to parse JSON policy file: ${policyPath} (${error.message})`),
    );
  }

  if (diagnostics.length > 0) {
    return {
      ok: false,
      schemaPath,
      policyPath,
      schemaDocument: schemaDocument ?? null,
      policyDocument: policyDocument ?? null,
      diagnostics: sortDiagnostics(diagnostics),
    };
  }

  return {
    ok: true,
    schemaPath,
    policyPath,
    schemaDocument,
    policyDocument,
    diagnostics: [],
  };
}

function validateRequiredDocTypes(requiredDocTypes, diagnostics) {
  if (!assertType(Array.isArray, requiredDocTypes, "schema.type_mismatch", `${DOCS_POLICY_VERSION_KEY}.required_doc_types`, `${DOCS_POLICY_VERSION_KEY}.required_doc_types must be an array.`, diagnostics)) {
    return;
  }

  const typeValues = [];
  const pathValues = [];

  for (const [index, item] of requiredDocTypes.entries()) {
    const path = `${DOCS_POLICY_VERSION_KEY}.required_doc_types[${index}]`;
    if (!assertType(isRecord, item, "schema.type_mismatch", path, `${path} must be an object.`, diagnostics)) {
      continue;
    }

    assertKnownKeys(item, REQUIRED_DOC_TYPE_ALLOWED_KEYS, path, diagnostics);
    assertRequiredKeys(item, ["doc_type", "path"], path, diagnostics);

    if (typeof item.doc_type === "string") {
      typeValues.push(item.doc_type);
    } else {
      diagnostics.push(createDiagnostic("schema.type_mismatch", `${path}.doc_type`, `${path}.doc_type must be a string.`));
    }

    if (typeof item.path === "string") {
      pathValues.push(item.path);
    } else {
      diagnostics.push(createDiagnostic("schema.type_mismatch", `${path}.path`, `${path}.path must be a string.`));
    }
  }

  assertNoDuplicateStrings(typeValues, `${DOCS_POLICY_VERSION_KEY}.required_doc_types.doc_type`, diagnostics, "required_doc_types.duplicate_doc_type");
  assertNoDuplicateStrings(pathValues, `${DOCS_POLICY_VERSION_KEY}.required_doc_types.path`, diagnostics, "required_doc_types.duplicate_path");

  if (!isLexicographicallySorted(typeValues)) {
    diagnostics.push(
      createDiagnostic(
        "ordering.non_canonical",
        `${DOCS_POLICY_VERSION_KEY}.required_doc_types`,
        `${DOCS_POLICY_VERSION_KEY}.required_doc_types must be sorted by doc_type in ascending lexical order.`,
      ),
    );
  }
}

function validateFreshness(node, diagnostics) {
  const path = `${DOCS_POLICY_VERSION_KEY}.freshness`;
  if (!assertType(isRecord, node, "schema.type_mismatch", path, `${path} must be an object.`, diagnostics)) {
    return;
  }

  assertKnownKeys(node, FRESHNESS_ALLOWED_KEYS, path, diagnostics);
  assertRequiredKeys(node, ["default_review_policy", "path_defaults", "review_policies"], path, diagnostics);

  const policyIds = [];

  if (assertType(Array.isArray, node.review_policies, "schema.type_mismatch", `${path}.review_policies`, `${path}.review_policies must be an array.`, diagnostics)) {
    for (const [index, entry] of node.review_policies.entries()) {
      const entryPath = `${path}.review_policies[${index}]`;
      if (!assertType(isRecord, entry, "schema.type_mismatch", entryPath, `${entryPath} must be an object.`, diagnostics)) {
        continue;
      }

      assertKnownKeys(entry, REVIEW_POLICY_ALLOWED_KEYS, entryPath, diagnostics);
      assertRequiredKeys(entry, ["id", "mode"], entryPath, diagnostics);

      if (typeof entry.id !== "string" || !entry.id.trim()) {
        diagnostics.push(createDiagnostic("schema.type_mismatch", `${entryPath}.id`, `${entryPath}.id must be a non-empty string.`));
      } else {
        policyIds.push(entry.id);
      }

      if (typeof entry.mode !== "string" || !["codebound", "generated", "historical", "periodic"].includes(entry.mode)) {
        diagnostics.push(createDiagnostic("schema.enum_invalid", `${entryPath}.mode`, `${entryPath}.mode must be one of: codebound, generated, historical, periodic.`));
      }

      if (entry.mode === "periodic") {
        if (!Number.isInteger(entry.max_age_days) || entry.max_age_days < 1) {
          diagnostics.push(createDiagnostic("schema.type_mismatch", `${entryPath}.max_age_days`, `${entryPath}.max_age_days must be an integer >= 1 for periodic review policies.`));
        }
      } else if (Object.hasOwn(entry, "max_age_days")) {
        diagnostics.push(createDiagnostic("schema.unexpected_key", `${entryPath}.max_age_days`, `${entryPath}.max_age_days is only allowed for periodic review policies.`));
      }
    }
  }

  assertNoDuplicateStrings(policyIds, `${path}.review_policies`, diagnostics);
  assertCanonicalStringArrayOrder(policyIds, `${path}.review_policies`, diagnostics);

  if (typeof node.default_review_policy !== "string" || !node.default_review_policy.trim()) {
    diagnostics.push(createDiagnostic("schema.type_mismatch", `${path}.default_review_policy`, `${path}.default_review_policy must be a non-empty string.`));
  } else if (!policyIds.includes(node.default_review_policy)) {
    diagnostics.push(createDiagnostic("schema.unknown_reference", `${path}.default_review_policy`, `${path}.default_review_policy must reference a declared review policy id.`));
  }

  if (assertType(Array.isArray, node.path_defaults, "schema.type_mismatch", `${path}.path_defaults`, `${path}.path_defaults must be an array.`, diagnostics)) {
    const defaultPaths = [];
    for (const [index, entry] of node.path_defaults.entries()) {
      const entryPath = `${path}.path_defaults[${index}]`;
      if (!assertType(isRecord, entry, "schema.type_mismatch", entryPath, `${entryPath} must be an object.`, diagnostics)) {
        continue;
      }

      assertKnownKeys(entry, PATH_DEFAULT_ALLOWED_KEYS, entryPath, diagnostics);
      assertRequiredKeys(entry, ["path", "review_policy"], entryPath, diagnostics);

      if (typeof entry.path !== "string" || !entry.path.trim()) {
        diagnostics.push(createDiagnostic("schema.type_mismatch", `${entryPath}.path`, `${entryPath}.path must be a non-empty string.`));
      } else {
        defaultPaths.push(entry.path);
      }

      if (typeof entry.review_policy !== "string" || !entry.review_policy.trim()) {
        diagnostics.push(createDiagnostic("schema.type_mismatch", `${entryPath}.review_policy`, `${entryPath}.review_policy must be a non-empty string.`));
      } else if (!policyIds.includes(entry.review_policy)) {
        diagnostics.push(createDiagnostic("schema.unknown_reference", `${entryPath}.review_policy`, `${entryPath}.review_policy must reference a declared review policy id.`));
      }
    }

    assertNoDuplicateStrings(defaultPaths, `${path}.path_defaults`, diagnostics);
    assertCanonicalStringArrayOrder(defaultPaths, `${path}.path_defaults`, diagnostics);
  }
}

function validateOwnership(ownership, diagnostics) {
  const ownershipPath = `${DOCS_POLICY_VERSION_KEY}.ownership`;
  if (!assertType(isRecord, ownership, "schema.type_mismatch", ownershipPath, `${ownershipPath} must be an object.`, diagnostics)) {
    return;
  }

  assertKnownKeys(ownership, OWNERSHIP_ALLOWED_KEYS, ownershipPath, diagnostics);
  assertRequiredKeys(ownership, ["canonical_roots", "owners", "root_doc_owner_id"], ownershipPath, diagnostics);

  const ownersPath = `${ownershipPath}.owners`;
  if (assertType(Array.isArray, ownership.owners, "schema.type_mismatch", ownersPath, `${ownersPath} must be an array.`, diagnostics)) {
    const ownerIds = [];

    for (const [index, owner] of ownership.owners.entries()) {
      const ownerPath = `${ownersPath}[${index}]`;
      if (!assertType(isRecord, owner, "schema.type_mismatch", ownerPath, `${ownerPath} must be an object.`, diagnostics)) {
        continue;
      }

      assertKnownKeys(owner, OWNER_ALLOWED_KEYS, ownerPath, diagnostics);
      assertRequiredKeys(owner, ["display_name", "id"], ownerPath, diagnostics);

      if (typeof owner.id === "string") {
        ownerIds.push(owner.id);
      } else {
        diagnostics.push(createDiagnostic("schema.type_mismatch", `${ownerPath}.id`, `${ownerPath}.id must be a string.`));
      }

      if (typeof owner.display_name !== "string") {
        diagnostics.push(createDiagnostic("schema.type_mismatch", `${ownerPath}.display_name`, `${ownerPath}.display_name must be a string.`));
      }
    }

    assertNoDuplicateStrings(ownerIds, ownersPath, diagnostics, "ownership.duplicate_owner_id");
    assertCanonicalStringArrayOrder(ownerIds, ownersPath, diagnostics);

    if (typeof ownership.root_doc_owner_id === "string" && !ownerIds.includes(ownership.root_doc_owner_id)) {
      diagnostics.push(
        createDiagnostic(
          "ownership.unknown_owner_id",
          `${ownershipPath}.root_doc_owner_id`,
          `root_doc_owner_id '${ownership.root_doc_owner_id}' is not declared in ownership.owners.`,
        ),
      );
    }

    const rootsPath = `${ownershipPath}.canonical_roots`;
    if (assertType(Array.isArray, ownership.canonical_roots, "schema.type_mismatch", rootsPath, `${rootsPath} must be an array.`, diagnostics)) {
      const rootPaths = [];

      for (const [index, root] of ownership.canonical_roots.entries()) {
        const rootPath = `${rootsPath}[${index}]`;
        if (!assertType(isRecord, root, "schema.type_mismatch", rootPath, `${rootPath} must be an object.`, diagnostics)) {
          continue;
        }

        assertKnownKeys(root, OWNERSHIP_ROOT_ALLOWED_KEYS, rootPath, diagnostics);
        assertRequiredKeys(root, ["owner_id", "path"], rootPath, diagnostics);

        if (typeof root.path === "string") {
          rootPaths.push(root.path);
        } else {
          diagnostics.push(createDiagnostic("schema.type_mismatch", `${rootPath}.path`, `${rootPath}.path must be a string.`));
        }

        if (typeof root.owner_id === "string") {
          if (!ownerIds.includes(root.owner_id)) {
            diagnostics.push(
              createDiagnostic(
                "ownership.unknown_owner_id",
                `${rootPath}.owner_id`,
                `owner_id '${root.owner_id}' is not declared in ownership.owners.`,
              ),
            );
          }
        } else {
          diagnostics.push(createDiagnostic("schema.type_mismatch", `${rootPath}.owner_id`, `${rootPath}.owner_id must be a string.`));
        }
      }

      assertNoDuplicateStrings(rootPaths, rootsPath, diagnostics, "ownership.duplicate_root_path");
      assertCanonicalStringArrayOrder(rootPaths, rootsPath, diagnostics);

      for (let leftIndex = 0; leftIndex < rootPaths.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < rootPaths.length; rightIndex += 1) {
          const left = rootPaths[leftIndex];
          const right = rootPaths[rightIndex];
          if (rootPathsConflict(left, right)) {
            diagnostics.push(
              createDiagnostic(
                "ownership.conflicting_root_paths",
                rootsPath,
                `Ownership roots conflict: '${left}' and '${right}' overlap.`,
              ),
            );
          }
        }
      }
    }
  }

  if (typeof ownership.root_doc_owner_id !== "string") {
    diagnostics.push(
      createDiagnostic(
        "schema.type_mismatch",
        `${ownershipPath}.root_doc_owner_id`,
        `${ownershipPath}.root_doc_owner_id must be a string.`,
      ),
    );
  }
}

function validateMigrationDebt(migrationDebt, diagnostics) {
  const path = `${DOCS_POLICY_VERSION_KEY}.migration_debt`;
  if (!assertType(isRecord, migrationDebt, "schema.type_mismatch", path, `${path} must be an object.`, diagnostics)) {
    return;
  }

  assertKnownKeys(migrationDebt, MIGRATION_DEBT_ALLOWED_KEYS, path, diagnostics);
  assertRequiredKeys(
    migrationDebt,
    [
      "allow_missing_required_doc_types",
      "allow_unowned_in_scope_paths",
      "legacy_in_scope_allowlist",
      "max_legacy_in_scope_allowlist_entries",
    ],
    path,
    diagnostics,
  );

  if (typeof migrationDebt.allow_missing_required_doc_types !== "boolean") {
    diagnostics.push(
      createDiagnostic(
        "schema.type_mismatch",
        `${path}.allow_missing_required_doc_types`,
        `${path}.allow_missing_required_doc_types must be a boolean.`,
      ),
    );
  }

  if (typeof migrationDebt.allow_unowned_in_scope_paths !== "boolean") {
    diagnostics.push(
      createDiagnostic(
        "schema.type_mismatch",
        `${path}.allow_unowned_in_scope_paths`,
        `${path}.allow_unowned_in_scope_paths must be a boolean.`,
      ),
    );
  }

  if (assertStringArray(migrationDebt.legacy_in_scope_allowlist, `${path}.legacy_in_scope_allowlist`, diagnostics)) {
    assertNoDuplicateStrings(migrationDebt.legacy_in_scope_allowlist, `${path}.legacy_in_scope_allowlist`, diagnostics);
    assertCanonicalStringArrayOrder(migrationDebt.legacy_in_scope_allowlist, `${path}.legacy_in_scope_allowlist`, diagnostics);
    if (
      Number.isInteger(migrationDebt.max_legacy_in_scope_allowlist_entries)
      && migrationDebt.legacy_in_scope_allowlist.length > migrationDebt.max_legacy_in_scope_allowlist_entries
    ) {
      diagnostics.push(
        createDiagnostic(
          "migration_debt.limit_exceeded",
          `${path}.legacy_in_scope_allowlist`,
          `legacy_in_scope_allowlist has ${migrationDebt.legacy_in_scope_allowlist.length} entries, which exceeds max_legacy_in_scope_allowlist_entries (${migrationDebt.max_legacy_in_scope_allowlist_entries}).`,
        ),
      );
    }
  }

  if (!Number.isInteger(migrationDebt.max_legacy_in_scope_allowlist_entries)) {
    diagnostics.push(
      createDiagnostic(
        "schema.type_mismatch",
        `${path}.max_legacy_in_scope_allowlist_entries`,
        `${path}.max_legacy_in_scope_allowlist_entries must be an integer.`,
      ),
    );
  } else if (migrationDebt.max_legacy_in_scope_allowlist_entries < 0) {
    diagnostics.push(
      createDiagnostic(
        "schema.type_mismatch",
        `${path}.max_legacy_in_scope_allowlist_entries`,
        `${path}.max_legacy_in_scope_allowlist_entries must be >= 0.`,
      ),
    );
  }
}

function ensureRequiredDocFilesExist(policy, diagnostics, options = {}) {
  const cwd = options.cwd ? resolve(options.cwd) : REPO_ROOT;
  const requiredDocTypes = policy.required_doc_types;
  if (!Array.isArray(requiredDocTypes)) {
    return;
  }

  for (const [index, entry] of requiredDocTypes.entries()) {
    if (!isRecord(entry) || typeof entry.path !== "string") {
      continue;
    }
    const absolutePath = resolve(cwd, entry.path);
    if (!existsSync(absolutePath)) {
      diagnostics.push(
        createDiagnostic(
          "required_doc_types.path_missing",
          `${DOCS_POLICY_VERSION_KEY}.required_doc_types[${index}].path`,
          `Required docs path does not exist: ${entry.path}`,
        ),
      );
    }
  }
}

function validateScope(policy, diagnostics) {
  const inScopePath = `${DOCS_POLICY_VERSION_KEY}.in_scope_paths`;
  if (assertStringArray(policy.in_scope_paths, inScopePath, diagnostics)) {
    assertNoDuplicateStrings(policy.in_scope_paths, inScopePath, diagnostics);
    assertCanonicalStringArrayOrder(policy.in_scope_paths, inScopePath, diagnostics);
  }

  const rootAllowlistPath = `${DOCS_POLICY_VERSION_KEY}.root_docs_allowlist`;
  if (assertStringArray(policy.root_docs_allowlist, rootAllowlistPath, diagnostics)) {
    assertNoDuplicateStrings(policy.root_docs_allowlist, rootAllowlistPath, diagnostics);
    assertCanonicalStringArrayOrder(policy.root_docs_allowlist, rootAllowlistPath, diagnostics);
  }

  const rootExceptionsPath = `${DOCS_POLICY_VERSION_KEY}.root_level_exceptions`;
  if (assertStringArray(policy.root_level_exceptions, rootExceptionsPath, diagnostics)) {
    assertNoDuplicateStrings(policy.root_level_exceptions, rootExceptionsPath, diagnostics);
    assertCanonicalStringArrayOrder(policy.root_level_exceptions, rootExceptionsPath, diagnostics);

    const allowlisted = new Set(Array.isArray(policy.root_docs_allowlist) ? policy.root_docs_allowlist : []);
    for (const entry of policy.root_level_exceptions) {
      if (!allowlisted.has(entry)) {
        diagnostics.push(
          createDiagnostic(
            "scope.root_exception_not_allowlisted",
            rootExceptionsPath,
            `Root-level exception '${entry}' must also appear in root_docs_allowlist.`,
          ),
        );
      }
    }
  }

  if (policy.frontmatter_exclude_globs !== undefined) {
    const frontmatterExcludePath = `${DOCS_POLICY_VERSION_KEY}.frontmatter_exclude_globs`;
    if (assertStringArray(policy.frontmatter_exclude_globs, frontmatterExcludePath, diagnostics)) {
      assertNoDuplicateStrings(policy.frontmatter_exclude_globs, frontmatterExcludePath, diagnostics);
      assertCanonicalStringArrayOrder(policy.frontmatter_exclude_globs, frontmatterExcludePath, diagnostics);
    }
  }

  if (policy.orphan_exclude_globs !== undefined) {
    const orphanExcludePath = `${DOCS_POLICY_VERSION_KEY}.orphan_exclude_globs`;
    if (assertStringArray(policy.orphan_exclude_globs, orphanExcludePath, diagnostics)) {
      assertNoDuplicateStrings(policy.orphan_exclude_globs, orphanExcludePath, diagnostics);
      assertCanonicalStringArrayOrder(policy.orphan_exclude_globs, orphanExcludePath, diagnostics);
    }
  }

  if (Array.isArray(policy.root_docs_allowlist) && Array.isArray(policy.in_scope_paths)) {
    const inScopePatterns = policy.in_scope_paths;
    for (const rootDoc of policy.root_docs_allowlist) {
      const covered = inScopePatterns.some((pattern) => matchesDocsPolicyPattern(rootDoc, pattern));
      if (!covered) {
        diagnostics.push(
          createDiagnostic(
            "scope.root_doc_not_in_scope",
            rootAllowlistPath,
            `Root allowlisted doc '${rootDoc}' is not covered by in_scope_paths.`,
          ),
        );
      }
    }
  }
}

function resolveSchemaVersionKey(schemaDocument) {
  if (!isRecord(schemaDocument)) {
    return null;
  }

  if (!isRecord(schemaDocument.properties)) {
    return null;
  }

  if (schemaDocument.properties[DOCS_POLICY_VERSION_KEY]) {
    return DOCS_POLICY_VERSION_KEY;
  }

  return null;
}

export function validateDocsPolicyDocuments(input, options = {}) {
  const diagnostics = [];
  const schemaDocument = input.schemaDocument;
  const policyDocument = input.policyDocument;

  if (!assertType(isRecord, schemaDocument, "schema.type_mismatch", "schema", "Schema document must be an object.", diagnostics)) {
    return {
      ok: false,
      diagnostics: sortDiagnostics(diagnostics),
      policy: null,
      versionKey: null,
    };
  }

  if (!assertType(isRecord, policyDocument, "schema.type_mismatch", "policy", "Policy document must be an object.", diagnostics)) {
    return {
      ok: false,
      diagnostics: sortDiagnostics(diagnostics),
      policy: null,
      versionKey: null,
    };
  }

  assertKnownKeys(policyDocument, TOP_LEVEL_ALLOWED_KEYS, "policy", diagnostics);
  const policyKeys = Object.keys(policyDocument);
  if (policyKeys.length !== 1 || policyKeys[0] !== DOCS_POLICY_VERSION_KEY) {
    diagnostics.push(
      createDiagnostic(
        "schema.version_key_invalid",
        "policy",
        `Policy root key must be exactly '${DOCS_POLICY_VERSION_KEY}'.`,
      ),
    );
  }

  const schemaVersionKey = resolveSchemaVersionKey(schemaDocument);
  if (schemaVersionKey !== DOCS_POLICY_VERSION_KEY) {
    diagnostics.push(
      createDiagnostic(
        "schema.version_key_invalid",
        "schema",
        `Schema must define '${DOCS_POLICY_VERSION_KEY}' in schema.properties.`,
      ),
    );
  }

  const policy = policyDocument[DOCS_POLICY_VERSION_KEY];
  if (!assertType(isRecord, policy, "schema.type_mismatch", DOCS_POLICY_VERSION_KEY, `${DOCS_POLICY_VERSION_KEY} must be an object.`, diagnostics)) {
    return {
      ok: false,
      diagnostics: sortDiagnostics(diagnostics),
      policy: null,
      versionKey: DOCS_POLICY_VERSION_KEY,
    };
  }

  assertKnownKeys(policy, POLICY_ALLOWED_KEYS, DOCS_POLICY_VERSION_KEY, diagnostics);
  assertRequiredKeys(
    policy,
    [
      "freshness",
      "in_scope_paths",
      "migration_debt",
      "ownership",
      "required_doc_types",
      "root_docs_allowlist",
      "root_level_exceptions",
    ],
    DOCS_POLICY_VERSION_KEY,
    diagnostics,
  );

  validateScope(policy, diagnostics);
  validateFreshness(policy.freshness, diagnostics);
  validateRequiredDocTypes(policy.required_doc_types, diagnostics);
  validateOwnership(policy.ownership, diagnostics);
  validateMigrationDebt(policy.migration_debt, diagnostics);
  if (!options.skipRequiredDocPathCheck) {
    ensureRequiredDocFilesExist(policy, diagnostics, options);
  }

  const sorted = sortDiagnostics(diagnostics);
  return {
    ok: sorted.length === 0,
    diagnostics: sorted,
    policy: sorted.length === 0 ? policy : null,
    versionKey: DOCS_POLICY_VERSION_KEY,
  };
}

export function loadAndValidateDocsPolicy(options = {}) {
  const loaded = loadDocsPolicyDocuments(options);
  if (!loaded.ok) {
    return {
      ok: false,
      schemaPath: loaded.schemaPath,
      policyPath: loaded.policyPath,
      diagnostics: loaded.diagnostics,
      policy: null,
      versionKey: null,
    };
  }

  const validation = validateDocsPolicyDocuments(
    {
      schemaDocument: loaded.schemaDocument,
      policyDocument: loaded.policyDocument,
    },
    options,
  );

  return {
    ok: validation.ok,
    schemaPath: loaded.schemaPath,
    policyPath: loaded.policyPath,
    diagnostics: validation.diagnostics,
    policy: validation.policy,
    versionKey: validation.versionKey,
  };
}

export function formatDocsPolicySummary(result) {
  const errors = result.diagnostics.length;
  const outcome = result.ok ? "ok" : "fail";
  return `[docs-policy] result=${outcome} errors=${errors} version_key=${JSON.stringify(result.versionKey ?? DOCS_POLICY_VERSION_KEY)}`;
}

export function isDocsPathInScope(pathValue, policy) {
  if (!policy || !Array.isArray(policy.in_scope_paths)) {
    return false;
  }

  return policy.in_scope_paths.some((pattern) => matchesDocsPolicyPattern(pathValue, pattern));
}

export function resolveDocsPolicyOrThrow(options = {}) {
  const result = loadAndValidateDocsPolicy(options);
  if (!result.ok || !result.policy) {
    const diagnostic = result.diagnostics[0];
    const reason = diagnostic ? `${diagnostic.code} at ${diagnostic.path}: ${diagnostic.message}` : "unknown validation failure";
    throw new Error(`Docs policy validation failed (${reason})`);
  }
  return result.policy;
}
