#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isDocsPathInScope, loadAndValidateDocsPolicy } from "./lib/docs-policy-validator.ts";
import { isArchivedDocPath } from "./lib/live-doc-assets-manifest.ts";

const SCHEMA_VERSION = "docs_index_generate/v1";
const DOCS_HIERARCHY_VERSION_KEY = "docs_hierarchy/v1";
const DEFAULT_HIERARCHY_PATH = "docs/docs-hierarchy.json";
const DEFAULT_INDEX_PATH = "docs/INDEX.md";

function normalizePath(pathValue) {
  return String(pathValue).replaceAll("\\", "/").replace(/^\.\//, "");
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

function listFilesFromGit(cwd, includeUntracked = false) {
  try {
    const args = ["ls-files", "-z", "--cached"];
    if (includeUntracked) {
      args.push("--others", "--exclude-standard");
    }

    const output = execFileSync("git", args, {
      cwd,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "ignore"],
    });

    const parts = output.toString("utf8").split("\0");
    if (parts[parts.length - 1] === "") {
      parts.pop();
    }

    return uniqueSorted(parts.map(normalizePath));
  } catch {
    return null;
  }
}

function listFilesFromFs(cwd) {
  const files = [];
  const queue = [""];

  while (queue.length > 0) {
    const relDir = queue.shift();
    const absoluteDir = resolve(cwd, relDir);
    const entries = readdirSync(absoluteDir, { withFileTypes: true })
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, "en"));

    for (const name of entries) {
      if (name === ".git" || name === "node_modules") {
        continue;
      }

      const childRel = relDir ? `${relDir}/${name}` : name;
      const childAbs = resolve(cwd, childRel);
      const entryStat = statSync(childAbs);

      if (entryStat.isDirectory()) {
        queue.push(childRel);
        continue;
      }

      if (entryStat.isFile()) {
        files.push(normalizePath(childRel));
      }
    }
  }

  return uniqueSorted(files);
}

function listRepositoryFiles(cwd, includeUntracked = false) {
  return listFilesFromGit(cwd, includeUntracked) ?? listFilesFromFs(cwd);
}

function createDiagnostic({ code, message, path = "", sectionId = "" }) {
  const id = `${code}:${path}:${sectionId}:${message}`;
  return {
    id,
    code,
    message,
    path,
    section_id: sectionId,
  };
}

function parseFrontmatter(markdown) {
  const lines = markdown.split(/\r?\n/);
  if ((lines[0] ?? "").trim() !== "---") {
    return {};
  }

  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex === -1) {
    return {};
  }

  const data = {};
  for (const line of lines.slice(1, closingIndex)) {
    const match = line.match(/^\s*([a-z][a-z0-9_]*)\s*:\s*(.+)\s*$/i);
    if (!match) {
      continue;
    }

    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }

  return data;
}

function readDocMetadata(cwd, docPath) {
  const absolutePath = resolve(cwd, docPath);
  if (!existsSync(absolutePath)) {
    return {
      title: basename(docPath),
      status: "",
    };
  }

  const markdown = readFileSync(absolutePath, "utf8");
  const frontmatter = parseFrontmatter(markdown);

  const lines = markdown.split(/\r?\n/);
  let title = "";
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)$/);
    if (match) {
      title = match[1].trim();
      break;
    }
  }

  return {
    title: title || basename(docPath),
    status: typeof frontmatter.status === "string" ? frontmatter.status.trim().toLowerCase() : "",
  };
}

function normalizeSectionPath(pathValue) {
  const normalized = normalizePath(pathValue);
  if (!normalized) {
    return "";
  }

  if (normalized.endsWith("/")) {
    return normalized;
  }

  return normalized;
}

function flattenSections(sections, diagnostics, parentId = "", level = 0, orderStart = 0) {
  const flattened = [];
  const seenIds = new Set();
  let order = orderStart;

  const visit = (entries, currentParentId, currentLevel) => {
    if (!Array.isArray(entries)) {
      return;
    }

    for (const entry of entries) {
      if (!entry || typeof entry !== "object") {
        diagnostics.push(
          createDiagnostic({
            code: "hierarchy.section_invalid",
            message: "Each hierarchy section must be an object.",
          }),
        );
        continue;
      }

      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      const title = typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : id;
      const pathValue = typeof entry.path === "string" ? normalizeSectionPath(entry.path) : "";

      if (!id) {
        diagnostics.push(
          createDiagnostic({
            code: "hierarchy.section_missing_id",
            message: "Hierarchy section is missing a non-empty id.",
            path: pathValue,
          }),
        );
        continue;
      }

      if (seenIds.has(id)) {
        diagnostics.push(
          createDiagnostic({
            code: "hierarchy.section_duplicate_id",
            message: `Duplicate hierarchy section id '${id}'.`,
            path: pathValue,
            sectionId: id,
          }),
        );
        continue;
      }

      if (!pathValue) {
        diagnostics.push(
          createDiagnostic({
            code: "hierarchy.section_missing_path",
            message: `Hierarchy section '${id}' must declare a non-empty path.`,
            sectionId: id,
          }),
        );
        continue;
      }

      const sectionRecord = {
        id,
        title,
        description: typeof entry.description === "string" ? entry.description.trim() : "",
        path: pathValue,
        required: entry.required === true,
        directFilesOnly: entry.direct_files_only === true,
        parentId: currentParentId,
        level: currentLevel,
        order,
      };

      order += 1;
      seenIds.add(id);
      flattened.push(sectionRecord);

      if (Array.isArray(entry.subsections)) {
        visit(entry.subsections, id, currentLevel + 1);
      }
    }
  };

  visit(sections, parentId, level);
  return flattened;
}

function matchSectionForDoc(docPath, sections) {
  const candidates = [];

  for (const section of sections) {
    const sectionPath = section.path;
    if (sectionPath.endsWith("/")) {
      if (!docPath.startsWith(sectionPath)) {
        continue;
      }

      const remainder = docPath.slice(sectionPath.length);
      if (section.directFilesOnly && remainder.includes("/")) {
        continue;
      }

      if (!remainder) {
        continue;
      }

      candidates.push(section);
      continue;
    }

    if (docPath === sectionPath) {
      candidates.push(section);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort((left, right) => {
    if (right.path.length !== left.path.length) {
      return right.path.length - left.path.length;
    }

    if (right.level !== left.level) {
      return right.level - left.level;
    }

    return left.id.localeCompare(right.id, "en");
  })[0];
}

function sortDiagnostics(diagnostics) {
  return [...diagnostics].sort((left, right) => {
    const leftKey = `${left.code}\u0000${left.path}\u0000${left.message}\u0000${left.section_id}`;
    const rightKey = `${right.code}\u0000${right.path}\u0000${right.message}\u0000${right.section_id}`;
    return leftKey.localeCompare(rightKey, "en");
  });
}

function buildSectionTree(flatSections) {
  const sectionById = new Map(flatSections.map((section) => [section.id, { ...section, children: [] }]));
  const roots = [];

  for (const section of sectionById.values()) {
    if (section.parentId && sectionById.has(section.parentId)) {
      sectionById.get(section.parentId).children.push(section);
      continue;
    }
    roots.push(section);
  }

  const sortByOrder = (entries) => entries.sort((left, right) => left.order - right.order);
  for (const section of sectionById.values()) {
    sortByOrder(section.children);
  }
  sortByOrder(roots);
  return roots;
}

function formatDocLink(docPath) {
  const relativePath = docPath.startsWith("docs/") ? docPath.slice("docs/".length) : docPath;
  return `./${relativePath}`;
}

function renderDocsList(docs) {
  if (docs.length === 0) {
    return ["- _No docs currently mapped._"];
  }

  return docs.map((doc) => `- [${doc.title}](${formatDocLink(doc.path)})`);
}

function renderSection(section, docsBySection, outputLines) {
  const heading = section.level === 0 ? "##" : "###";
  outputLines.push(`${heading} ${section.title}`);
  outputLines.push("");

  if (section.description) {
    outputLines.push(section.description);
    outputLines.push("");
  }

  const docs = docsBySection.get(section.id) ?? [];
  outputLines.push(...renderDocsList(docs));
  outputLines.push("");

  for (const child of section.children) {
    renderSection(child, docsBySection, outputLines);
  }
}

function buildIndexMarkdown({ sectionTree, docsBySection }) {
  const freshnessDate = "2026-03-19";
  const lines = [
    "---",
    "doc_type: \"architecture\"",
    "owner: \"docs-stewards\"",
    "status: \"active\"",
    `review_policy: "generated"`,
    `reviewed: "${freshnessDate}"`,
    "tags: [docs, governance, index]",
    `written: "${freshnessDate}"`,
    "summary: \"Generated hierarchy index for policy-scoped documentation.\"",
    "---",
    "",
    "# Documentation Index",
    "",
    "Generated by `pnpm docs:index:generate`. Do not edit this file manually.",
    "",
  ];

  for (const section of sectionTree) {
    renderSection(section, docsBySection, lines);
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function loadHierarchyManifest(cwd, hierarchyPath) {
  const absolutePath = resolve(cwd, hierarchyPath ?? DEFAULT_HIERARCHY_PATH);
  if (!existsSync(absolutePath)) {
    throw new Error(`Docs hierarchy manifest not found: ${absolutePath}`);
  }

  let document;
  try {
    document = JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to parse docs hierarchy manifest JSON: ${error.message}`);
  }

  const node = document?.[DOCS_HIERARCHY_VERSION_KEY];
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new Error(`Docs hierarchy manifest must define object key '${DOCS_HIERARCHY_VERSION_KEY}'.`);
  }

  if (!Array.isArray(node.sections)) {
    throw new Error(`${DOCS_HIERARCHY_VERSION_KEY}.sections must be an array.`);
  }

  return {
    path: normalizePath(relative(cwd, absolutePath)),
    sections: node.sections,
  };
}

function resolveDocsPolicyOrThrow(options = {}) {
  const policyResult = loadAndValidateDocsPolicy({
    cwd: options.cwd,
    policyPath: options.policyPath,
    schemaPath: options.policySchemaPath,
    skipRequiredDocPathCheck: true,
  });

  if (!policyResult.ok || !policyResult.policy) {
    const diagnostic = policyResult.diagnostics[0];
    const details = diagnostic
      ? `${diagnostic.code} at ${diagnostic.path}: ${diagnostic.message}`
      : "unknown policy validation failure";
    throw new Error(`docs policy validation failed (${details})`);
  }

  return policyResult.policy;
}

export function runDocsIndexGenerate(options = {}) {
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const policy = resolveDocsPolicyOrThrow({
    cwd,
    policyPath: options.policyPath,
    policySchemaPath: options.policySchemaPath,
  });

  const hierarchyManifest = loadHierarchyManifest(cwd, options.hierarchyPath);
  const diagnostics = [];
  const flatSections = flattenSections(hierarchyManifest.sections, diagnostics);
  const sortedSections = [...flatSections].sort((left, right) => left.order - right.order);

  const allFiles = listRepositoryFiles(cwd, options.includeUntracked === true);
  const indexPath = normalizePath(options.indexPath ?? DEFAULT_INDEX_PATH);

  const docsPaths = uniqueSorted(
    [...allFiles, indexPath]
      .filter((pathValue) => pathValue.toLowerCase().endsWith(".md"))
      .filter((pathValue) => pathValue.startsWith("docs/"))
      .filter((pathValue) => isDocsPathInScope(pathValue, policy)),
  );

  const docsBySection = new Map(sortedSections.map((section) => [section.id, []]));
  const archivedDocs = [];
  const indexAbsolutePath = resolve(cwd, indexPath);
  const indexExists = existsSync(indexAbsolutePath);

  for (const docPath of docsPaths) {
    const metadata = !indexExists && docPath === indexPath
      ? { title: "Documentation Index", status: "" }
      : readDocMetadata(cwd, docPath);
    const archivedByStatus = metadata.status === "archived";
    if (isArchivedDocPath(docPath) || archivedByStatus) {
      archivedDocs.push(docPath);
      continue;
    }

    const matchedSection = matchSectionForDoc(docPath, sortedSections);
    if (!matchedSection) {
      diagnostics.push(
        createDiagnostic({
          code: "hierarchy.unmapped_doc",
          message: `Document path is outside declared hierarchy: ${docPath}`,
          path: docPath,
        }),
      );
      continue;
    }

    const list = docsBySection.get(matchedSection.id) ?? [];
    list.push({
      path: docPath,
      title: metadata.title,
    });
    docsBySection.set(matchedSection.id, list);
  }

  for (const [sectionId, docs] of docsBySection.entries()) {
    docsBySection.set(
      sectionId,
      [...docs].sort((left, right) => {
        if (left.path !== right.path) {
          return left.path.localeCompare(right.path, "en");
        }
        return left.title.localeCompare(right.title, "en");
      }),
    );
  }

  const sectionTree = buildSectionTree(sortedSections);
  const indexMarkdown = buildIndexMarkdown({ sectionTree, docsBySection });

  mkdirSync(dirname(indexAbsolutePath), { recursive: true });
  writeFileSync(indexAbsolutePath, indexMarkdown, "utf8");

  const sortedDiagnostics = sortDiagnostics(diagnostics);
  return {
    schema_version: SCHEMA_VERSION,
    ok: sortedDiagnostics.length === 0,
    summary: {
      docs: docsPaths.length,
      archived_docs: archivedDocs.length,
      sections: sortedSections.length,
      diagnostics: sortedDiagnostics.length,
      index_path: indexPath,
      hierarchy_path: hierarchyManifest.path,
    },
    hierarchy_path: hierarchyManifest.path,
    index_path: indexPath,
    sections: sortedSections.map((section) => ({
      id: section.id,
      title: section.title,
      path: section.path,
      parent_id: section.parentId,
      level: section.level,
      required: section.required,
      direct_files_only: section.directFilesOnly,
      docs: (docsBySection.get(section.id) ?? []).map((doc) => doc.path),
    })),
    archived_docs: uniqueSorted(archivedDocs),
    docs: docsPaths,
    diagnostics: sortedDiagnostics,
  };
}

export function formatDocsIndexSummary(report) {
  const result = report.ok ? "ok" : "fail";
  return `[docs-index] result=${result} diagnostics=${report.summary.diagnostics} docs=${report.summary.docs} archived=${report.summary.archived_docs} sections=${report.summary.sections}`;
}

function parseArgs(argv) {
  const options = {
    policyPath: undefined,
    policySchemaPath: undefined,
    hierarchyPath: undefined,
    indexPath: undefined,
    includeUntracked: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--policy") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--policy requires a path");
      }
      options.policyPath = value;
      index += 1;
      continue;
    }

    if (arg === "--policy-schema") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--policy-schema requires a path");
      }
      options.policySchemaPath = value;
      index += 1;
      continue;
    }

    if (arg === "--hierarchy") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--hierarchy requires a path");
      }
      options.hierarchyPath = value;
      index += 1;
      continue;
    }

    if (arg === "--index") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--index requires a path");
      }
      options.indexPath = value;
      index += 1;
      continue;
    }

    if (arg === "--include-untracked") {
      options.includeUntracked = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      process.stdout.write("Usage: node scripts/docs-index-generate.mjs [--policy <path>] [--policy-schema <path>] [--hierarchy <path>] [--index <path>] [--include-untracked]\n");
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = runDocsIndexGenerate({
      cwd: process.cwd(),
      policyPath: options.policyPath,
      policySchemaPath: options.policySchemaPath,
      hierarchyPath: options.hierarchyPath,
      indexPath: options.indexPath,
      includeUntracked: options.includeUntracked,
    });

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.stderr.write(`${formatDocsIndexSummary(report)}\n`);

    if (!report.ok) {
      process.exit(1);
    }
  } catch (error) {
    process.stderr.write(`[docs-index] fatal=${JSON.stringify({ message: error.message })}\n`);
    process.exit(1);
  }
}
