import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

export const DEFAULT_CANONICAL_DOCS = [
  "README.md",
  "docs/factory-supervisor-tick.md",
  "docs/state-machines.md",
];

export const DISALLOWED_LEGACY_TOKENS = [
  "taxi new",
  "taxi serve",
  "apps/taxi/src",
  ".taxi/runs",
];

export const CANONICAL_DOCS_GUARD_CODE = "canonical_docs.legacy_reference";
export const CANONICAL_DOCS_MISSING_FILE_CODE = "canonical_docs.missing_file";
export const FORBIDDEN_DOC_PATH_CODE = "canonical_docs.forbidden_path";
export const FORBIDDEN_DOC_FILENAME_CODE = "canonical_docs.forbidden_filename";
export const FORBIDDEN_DOC_STATUS_CODE = "canonical_docs.forbidden_status";

export const FORBIDDEN_DOC_PATH_PREFIXES = Object.freeze([
  "docs/archive/",
  "docs/intents/",
  "docs/issues/",
  "docs/skills/factory-design-workspace/",
]);

export const FORBIDDEN_DOC_FILENAME_PATTERNS = Object.freeze([
  /(?:^|\/)[^/]*-plan\.md$/i,
  /(?:^|\/)[^/]*-needs\.md$/i,
  /(?:^|\/)[^/]*-proposal\.md$/i,
]);

export const FORBIDDEN_DOC_STATUSES = Object.freeze([
  "archived",
  "draft",
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

function normalizePath(pathValue) {
  return String(pathValue).replaceAll("\\", "/").replace(/^\.\//, "");
}

function uniqueSorted(values) {
  return [...new Set(values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .map(normalizePath))]
    .sort((left, right) => left.localeCompare(right, "en"));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function listMarkdownDocs(cwd, relDir = "docs") {
  const root = resolve(cwd, relDir);
  if (!existsSync(root)) {
    return [];
  }

  const queue = [relDir];
  const docs = [];

  while (queue.length > 0) {
    const current = queue.shift();
    const absolute = resolve(cwd, current);
    const entries = readdirSync(absolute, { withFileTypes: true })
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, "en"));

    for (const name of entries) {
      const childRel = normalizePath(`${current}/${name}`);
      const childAbs = resolve(cwd, childRel);
      const childStat = statSync(childAbs);

      if (childStat.isDirectory()) {
        queue.push(childRel);
        continue;
      }

      if (childStat.isFile() && childRel.endsWith(".md")) {
        docs.push(childRel);
      }
    }
  }

  return uniqueSorted(docs);
}

function parseFrontmatterStatus(markdown) {
  const lines = markdown.split(/\r?\n/);
  if ((lines[0] ?? "").trim() !== "---") {
    return "";
  }

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === "---") {
      break;
    }

    const match = line.match(/^status:\s*"?([^"]+?)"?\s*$/i);
    if (match) {
      return String(match[1] ?? "").trim().toLowerCase();
    }
  }

  return "";
}

export function runCanonicalDocsGuard(options = {}) {
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const docsToCheck = uniqueSorted(
    Array.isArray(options.docsToCheck) && options.docsToCheck.length > 0
      ? options.docsToCheck
      : DEFAULT_CANONICAL_DOCS,
  );
  const docsToScan = uniqueSorted(
    Array.isArray(options.docsToScan) && options.docsToScan.length > 0
      ? options.docsToScan
      : listMarkdownDocs(cwd),
  );

  const diagnostics = [];

  for (const pathValue of docsToCheck) {
    const absolutePath = resolve(cwd, pathValue);
    if (!existsSync(absolutePath)) {
      diagnostics.push(
        createDiagnostic(
          CANONICAL_DOCS_MISSING_FILE_CODE,
          pathValue,
          `Canonical docs guard could not read file: ${pathValue}`,
        ),
      );
      continue;
    }

    const source = readFileSync(absolutePath, "utf8");

    for (const token of DISALLOWED_LEGACY_TOKENS) {
      const matcher = new RegExp(escapeRegex(token), "i");
      const match = source.match(matcher);
      if (!match) {
        continue;
      }

      diagnostics.push(
        createDiagnostic(
          CANONICAL_DOCS_GUARD_CODE,
          pathValue,
          `Canonical doc contains legacy reference '${match[0]}'. Move legacy command/path references to historical docs and keep canonical docs Hatch/Mothership-first.`,
        ),
      );
    }
  }

  for (const docPath of docsToScan) {
    const absolutePath = resolve(cwd, docPath);
    if (!existsSync(absolutePath)) {
      continue;
    }

    const forbiddenPrefix = FORBIDDEN_DOC_PATH_PREFIXES.find((prefix) => docPath.startsWith(prefix));
    if (forbiddenPrefix) {
      diagnostics.push(
        createDiagnostic(
          FORBIDDEN_DOC_PATH_CODE,
          docPath,
          `Forbidden docs path '${docPath}'. Keep canonical docs free of archive, issue-mirror, intent, and workspace-output trees.`,
        ),
      );
    }

    const forbiddenPattern = FORBIDDEN_DOC_FILENAME_PATTERNS.find((pattern) => pattern.test(docPath));
    if (forbiddenPattern) {
      diagnostics.push(
        createDiagnostic(
          FORBIDDEN_DOC_FILENAME_CODE,
          docPath,
          `Forbidden canonical doc filename '${docPath}'. Do not keep plan, needs, or proposal docs in canonical docs/.`,
        ),
      );
    }

    const source = readFileSync(absolutePath, "utf8");
    const status = parseFrontmatterStatus(source);
    if (FORBIDDEN_DOC_STATUSES.includes(status)) {
      diagnostics.push(
        createDiagnostic(
          FORBIDDEN_DOC_STATUS_CODE,
          docPath,
          `Forbidden doc status '${status}' in '${docPath}'. Canonical docs must be active, not draft or archived.`,
        ),
      );
    }
  }

  const sorted = sortDiagnostics(diagnostics);
  return {
    ok: sorted.length === 0,
    diagnostics: sorted,
    docsToCheck,
    docsToScan,
  };
}
