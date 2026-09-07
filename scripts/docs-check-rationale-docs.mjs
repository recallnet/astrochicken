import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import {
  normalizeRationaleDocStructure,
  RATIONALE_DOC_SECTION_HEADINGS,
} from "../packages/factory-ops/src/lib/goal-rationale-doc.ts";

const REPORT_SCHEMA_VERSION = "docs_rationale_check/v1";
const RATIONALE_PATH_PREFIX = "docs/rationale/";
const RATIONALE_FILENAME_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$/;

function normalizePath(pathValue) {
  return String(pathValue || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function listTrackedDocsFiles(cwd) {
  const output = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "docs"], {
    cwd,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return output.toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map(normalizePath)
    .sort((left, right) => left.localeCompare(right, "en"));
}

function extractFrontmatter(markdown = "") {
  const text = String(markdown || "");
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return null;
  return text.slice(4, end);
}

function extractTags(frontmatter = "") {
  const inlineMatch = String(frontmatter || "").match(/^tags:\s*\[(.*)\]\s*$/m);
  if (inlineMatch) {
    return inlineMatch[1]
      .split(",")
      .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }

  const lines = String(frontmatter || "").split(/\r?\n/);
  const tagsIndex = lines.findIndex((line) => /^tags:\s*$/.test(line.trim()));
  if (tagsIndex < 0) return [];

  const tags = [];
  for (let index = tagsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^\s*-\s+/.test(line)) break;
    tags.push(line.replace(/^\s*-\s+/, "").trim().replace(/^['"]|['"]$/g, ""));
  }
  return tags;
}

function createDiagnostic({ code, path, message }) {
  return { code, path, message };
}

function extractSections(markdown = "") {
  const lines = String(markdown || "").split(/\r?\n/);
  const sections = new Map();
  let currentHeading = "";
  let buffer = [];

  const flush = () => {
    if (!currentHeading) return;
    sections.set(currentHeading, buffer.join("\n").trim());
  };

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[1].trim();
      buffer = [];
      continue;
    }
    if (currentHeading) {
      buffer.push(line);
    }
  }
  flush();

  return sections;
}

export function validateRationaleDoc({ path = "", markdown = "" } = {}) {
  const diagnostics = [];
  const normalizedPath = normalizePath(path);
  const fileName = basename(normalizedPath);

  if (!RATIONALE_FILENAME_PATTERN.test(fileName)) {
    diagnostics.push(createDiagnostic({
      code: "rationale.invalid_filename",
      path: normalizedPath,
      message: "Rationale docs must live at docs/rationale/YYYY-MM-DD-slug.md.",
    }));
  }

  const frontmatter = extractFrontmatter(markdown);
  if (!frontmatter) {
    diagnostics.push(createDiagnostic({
      code: "rationale.missing_frontmatter",
      path: normalizedPath,
      message: "Rationale docs must include standard docs frontmatter.",
    }));
  } else {
    const tags = extractTags(frontmatter);
    if (tags.length !== 1 || tags[0] !== "rationale") {
      diagnostics.push(createDiagnostic({
        code: "rationale.invalid_tags",
        path: normalizedPath,
        message: "Rationale docs must use exactly one tag: rationale.",
      }));
    }
  }

  const sections = extractSections(markdown);
  const structure = normalizeRationaleDocStructure(markdown);
  for (const heading of structure.missing_headings) {
    diagnostics.push(createDiagnostic({
      code: "rationale.missing_heading",
      path: normalizedPath,
      message: `Missing required section heading '${heading}'.`,
    }));
  }
  for (const phrase of structure.banned_phrases) {
    diagnostics.push(createDiagnostic({
      code: "rationale.banned_phrase",
      path: normalizedPath,
      message: `Contains banned filler phrase '${phrase}'.`,
    }));
  }
  if (!structure.has_concrete_ref) {
    diagnostics.push(createDiagnostic({
      code: "rationale.missing_concrete_ref",
      path: normalizedPath,
      message: "Rationale docs must include at least one concrete file or symbol reference.",
    }));
  }

  for (const heading of RATIONALE_DOC_SECTION_HEADINGS) {
    const content = sections.get(heading) || "";
    if (content.length < 24) {
      diagnostics.push(createDiagnostic({
        code: "rationale.short_section",
        path: normalizedPath,
        message: `Section '${heading}' is too short to be useful.`,
      }));
    }
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
  };
}

export function runRationaleDocsCheck({ cwd = process.cwd() } = {}) {
  const files = listTrackedDocsFiles(cwd).filter((path) => path.startsWith(RATIONALE_PATH_PREFIX));
  const diagnostics = [];

  for (const path of files) {
    const markdown = readFileSync(resolve(cwd, path), "utf8");
    const report = validateRationaleDoc({ path, markdown });
    diagnostics.push(...report.diagnostics);
  }

  diagnostics.sort((left, right) => {
    const leftKey = `${left.path}\u0000${left.code}\u0000${left.message}`;
    const rightKey = `${right.path}\u0000${right.code}\u0000${right.message}`;
    return leftKey.localeCompare(rightKey, "en");
  });

  return {
    ok: diagnostics.length === 0,
    schema_version: REPORT_SCHEMA_VERSION,
    file_count: files.length,
    diagnostics,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = runRationaleDocsCheck();
  if (!report.ok) {
    for (const diagnostic of report.diagnostics) {
      process.stderr.write(`[docs-rationale] diagnostic=${JSON.stringify(diagnostic)}\n`);
    }
  }
  process.stderr.write(`[docs-rationale] result=${report.ok ? "ok" : "fail"} errors=${report.diagnostics.length} files=${report.file_count} version_key="${REPORT_SCHEMA_VERSION}"\n`);
  process.exit(report.ok ? 0 : 1);
}
