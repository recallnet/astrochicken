import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const DOCS_TEMPLATES_VERSION_KEY = "docs_templates/v1";
export const DOCS_TEMPLATES_RELATIVE_PATH = "docs/templates/templates.json";

export function wildcardPatternToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function matchesDocsTemplateFrameworkPattern(pathValue, pattern) {
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

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\//, "");
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

function parseJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

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

function headingLinesFromTemplate(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("## "));
}

function assertSortedUniqueStrings(values, path, diagnostics) {
  const sorted = [...values].sort((left, right) => left.localeCompare(right, "en"));
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] !== sorted[index]) {
      diagnostics.push(
        createDiagnostic("ordering.non_canonical", path, `${path} must be lexicographically sorted.`),
      );
      break;
    }
  }

  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      diagnostics.push(
        createDiagnostic("schema.duplicate_value", path, `Duplicate value '${value}' at ${path}.`),
      );
      continue;
    }
    seen.add(value);
  }
}

export function loadDocsTemplatesManifest(options = {}) {
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const manifestPath = options.manifestPath
    ? resolve(cwd, options.manifestPath)
    : resolve(cwd, DOCS_TEMPLATES_RELATIVE_PATH);

  const diagnostics = [];
  if (!existsSync(manifestPath)) {
    diagnostics.push(createDiagnostic("io.missing_file", "manifest", `Templates manifest not found: ${manifestPath}`));
    return {
      ok: false,
      manifestPath,
      manifest: null,
      diagnostics,
    };
  }

  let manifest = null;
  try {
    manifest = parseJson(manifestPath);
  } catch (error) {
    diagnostics.push(createDiagnostic("io.invalid_json", "manifest", `Failed to parse templates manifest JSON: ${error.message}`));
  }

  if (diagnostics.length > 0) {
    return {
      ok: false,
      manifestPath,
      manifest: null,
      diagnostics: sortDiagnostics(diagnostics),
    };
  }

  return {
    ok: true,
    manifestPath,
    manifest,
    diagnostics: [],
  };
}

export function validateDocsTemplatesManifest(input, options = {}) {
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const diagnostics = [];

  if (!isRecord(input.manifest)) {
    diagnostics.push(createDiagnostic("schema.type_mismatch", "manifest", "Templates manifest must be an object."));
    return {
      ok: false,
      diagnostics: sortDiagnostics(diagnostics),
      templates: [],
      requiredFrontmatterKeys: [],
      sharedSections: [],
    };
  }

  const manifest = input.manifest;
  const manifestNode = manifest[DOCS_TEMPLATES_VERSION_KEY];
  if (!isRecord(manifestNode)) {
    diagnostics.push(
      createDiagnostic(
        "schema.version_key_invalid",
        DOCS_TEMPLATES_VERSION_KEY,
        `Templates manifest must define object key '${DOCS_TEMPLATES_VERSION_KEY}'.`,
      ),
    );
    return {
      ok: false,
      diagnostics: sortDiagnostics(diagnostics),
      templates: [],
      requiredFrontmatterKeys: [],
      sharedSections: [],
    };
  }

  const requiredFrontmatterKeys = Array.isArray(manifestNode.required_frontmatter_keys)
    ? manifestNode.required_frontmatter_keys
    : [];
  if (!Array.isArray(manifestNode.required_frontmatter_keys)) {
    diagnostics.push(
      createDiagnostic(
        "schema.type_mismatch",
        `${DOCS_TEMPLATES_VERSION_KEY}.required_frontmatter_keys`,
        "required_frontmatter_keys must be an array.",
      ),
    );
  } else {
    for (const [index, key] of requiredFrontmatterKeys.entries()) {
      if (typeof key !== "string" || !key) {
        diagnostics.push(
          createDiagnostic(
            "schema.type_mismatch",
            `${DOCS_TEMPLATES_VERSION_KEY}.required_frontmatter_keys[${index}]`,
            "required_frontmatter_keys entries must be non-empty strings.",
          ),
        );
      }
    }
    assertSortedUniqueStrings(requiredFrontmatterKeys, `${DOCS_TEMPLATES_VERSION_KEY}.required_frontmatter_keys`, diagnostics);
  }

  if (typeof manifestNode.shared_sections_path !== "string" || !manifestNode.shared_sections_path) {
    diagnostics.push(
      createDiagnostic(
        "schema.type_mismatch",
        `${DOCS_TEMPLATES_VERSION_KEY}.shared_sections_path`,
        "shared_sections_path must be a non-empty string.",
      ),
    );
  }

  const sharedSectionsPath = typeof manifestNode.shared_sections_path === "string"
    ? normalizePath(manifestNode.shared_sections_path)
    : "";

  const templates = Array.isArray(manifestNode.templates) ? manifestNode.templates : [];
  if (!Array.isArray(manifestNode.templates)) {
    diagnostics.push(
      createDiagnostic(
        "schema.type_mismatch",
        `${DOCS_TEMPLATES_VERSION_KEY}.templates`,
        "templates must be an array.",
      ),
    );
  }

  const templateRecords = [];

  for (const [index, entry] of templates.entries()) {
    const entryPath = `${DOCS_TEMPLATES_VERSION_KEY}.templates[${index}]`;
    if (!isRecord(entry)) {
      diagnostics.push(createDiagnostic("schema.type_mismatch", entryPath, "template entry must be an object."));
      continue;
    }

    const template = {
      id: typeof entry.id === "string" ? entry.id : "",
      doc_type: typeof entry.doc_type === "string" ? entry.doc_type : "",
      title: typeof entry.title === "string" ? entry.title : "",
      path: typeof entry.path === "string" ? normalizePath(entry.path) : "",
      sections: Array.isArray(entry.sections) ? entry.sections : [],
    };

    if (!template.id) {
      diagnostics.push(createDiagnostic("schema.type_mismatch", `${entryPath}.id`, "id must be a non-empty string."));
    }
    if (!template.doc_type) {
      diagnostics.push(createDiagnostic("schema.type_mismatch", `${entryPath}.doc_type`, "doc_type must be a non-empty string."));
    }
    if (!template.title) {
      diagnostics.push(createDiagnostic("schema.type_mismatch", `${entryPath}.title`, "title must be a non-empty string."));
    }
    if (!template.path) {
      diagnostics.push(createDiagnostic("schema.type_mismatch", `${entryPath}.path`, "path must be a non-empty string."));
    }

    if (!Array.isArray(entry.sections)) {
      diagnostics.push(createDiagnostic("schema.type_mismatch", `${entryPath}.sections`, "sections must be an array."));
    } else {
      for (const [sectionIndex, section] of template.sections.entries()) {
        if (typeof section !== "string" || !section.startsWith("## ")) {
          diagnostics.push(
            createDiagnostic(
              "schema.type_mismatch",
              `${entryPath}.sections[${sectionIndex}]`,
              "sections entries must be markdown H2 headings (start with '## ').",
            ),
          );
        }
      }
    }

    templateRecords.push(template);
  }

  const templateIds = templateRecords.map((entry) => entry.id).filter(Boolean);
  assertSortedUniqueStrings(templateIds, `${DOCS_TEMPLATES_VERSION_KEY}.templates.id`, diagnostics);

  const resolvedSharedPath = sharedSectionsPath ? resolve(cwd, sharedSectionsPath) : "";
  let sharedSections = [];
  if (resolvedSharedPath && existsSync(resolvedSharedPath)) {
    const sharedSource = readFileSync(resolvedSharedPath, "utf8");
    sharedSections = headingLinesFromTemplate(sharedSource);
    if (sharedSections.length === 0) {
      diagnostics.push(
        createDiagnostic(
          "templates.shared_sections_missing",
          sharedSectionsPath,
          "shared sections template must include at least one H2 heading.",
        ),
      );
    }
  } else if (sharedSectionsPath) {
    diagnostics.push(
      createDiagnostic("io.missing_file", sharedSectionsPath, `Shared sections template not found: ${sharedSectionsPath}`),
    );
  }

  for (const template of templateRecords) {
    if (!template.path) {
      continue;
    }

    const absoluteTemplatePath = resolve(cwd, template.path);
    if (!existsSync(absoluteTemplatePath)) {
      diagnostics.push(createDiagnostic("io.missing_file", template.path, `Template file not found: ${template.path}`));
      continue;
    }

    const source = readFileSync(absoluteTemplatePath, "utf8");
    const headings = headingLinesFromTemplate(source);
    const expectedHeadings = [...sharedSections, ...template.sections];

    if (headings.length !== expectedHeadings.length) {
      diagnostics.push(
        createDiagnostic(
          "templates.section_count_mismatch",
          template.path,
          `Template heading count mismatch: expected ${expectedHeadings.length}, got ${headings.length}.`,
        ),
      );
      continue;
    }

    for (let index = 0; index < expectedHeadings.length; index += 1) {
      if (headings[index] !== expectedHeadings[index]) {
        diagnostics.push(
          createDiagnostic(
            "templates.section_order_invalid",
            template.path,
            `Template heading at index ${index} must be '${expectedHeadings[index]}', got '${headings[index]}'.`,
          ),
        );
        break;
      }
    }
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics: sortDiagnostics(diagnostics),
    templates: templateRecords,
    requiredFrontmatterKeys,
    sharedSections,
  };
}

export function loadAndValidateDocsTemplates(options = {}) {
  const loaded = loadDocsTemplatesManifest(options);
  if (!loaded.ok) {
    return {
      ok: false,
      manifestPath: loaded.manifestPath,
      diagnostics: loaded.diagnostics,
      templates: [],
      requiredFrontmatterKeys: [],
      sharedSections: [],
    };
  }

  const validation = validateDocsTemplatesManifest({ manifest: loaded.manifest }, options);
  return {
    ok: validation.ok,
    manifestPath: loaded.manifestPath,
    diagnostics: validation.diagnostics,
    templates: validation.templates,
    requiredFrontmatterKeys: validation.requiredFrontmatterKeys,
    sharedSections: validation.sharedSections,
  };
}

function yamlEscape(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function renderYamlValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => String(item)).join(", ")}]`;
  }
  return yamlEscape(value);
}

function renderFrontmatter(frontmatter, keyOrder) {
  const lines = ["---"];
  for (const key of keyOrder) {
    lines.push(`${key}: ${renderYamlValue(frontmatter[key])}`);
  }
  lines.push("---", "");
  return `${lines.join("\n")}`;
}

function replaceTokens(source, values) {
  return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, token) => {
    if (!(token in values)) {
      return "";
    }
    return String(values[token]);
  });
}

export function normalizeTemplateTags(rawTags) {
  if (Array.isArray(rawTags)) {
    return uniqueSorted(rawTags.map((entry) => String(entry).trim()).filter(Boolean));
  }

  if (typeof rawTags === "string") {
    return uniqueSorted(rawTags.split(",").map((entry) => entry.trim()).filter(Boolean));
  }

  return [];
}

export function scaffoldDocFromTemplate(options = {}) {
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const templateId = String(options.templateId ?? "").trim();
  if (!templateId) {
    throw new Error("templateId is required");
  }

  const templatesResult = loadAndValidateDocsTemplates({
    cwd,
    manifestPath: options.manifestPath,
  });
  if (!templatesResult.ok) {
    const first = templatesResult.diagnostics[0];
    throw new Error(`template manifest validation failed (${first.code} at ${first.path}: ${first.message})`);
  }

  const template = templatesResult.templates.find((entry) => entry.id === templateId);
  if (!template) {
    const known = templatesResult.templates.map((entry) => entry.id).sort((left, right) => left.localeCompare(right, "en"));
    throw new Error(`unknown template id '${templateId}' (known: ${known.join(", ")})`);
  }

  const tags = normalizeTemplateTags(options.tags);
  const resolvedTags = tags.length > 0 ? tags : uniqueSorted(["docs", template.id]);

  const frontmatter = {
    doc_type: template.doc_type,
    owner: options.owner ?? "docs-stewards",
    status: options.status ?? "draft",
    written: options.written ?? options.lastUpdated ?? "1970-01-01",
    reviewed: options.reviewed ?? options.lastUpdated ?? "1970-01-01",
    review_policy: options.reviewPolicy ?? "periodic-7",
    tags: resolvedTags,
    summary: options.summary ?? "TODO: add summary",
  };

  const values = {
    title: options.title ?? template.title,
    owner: frontmatter.owner,
    status: frontmatter.status,
    written: frontmatter.written,
    reviewed: frontmatter.reviewed,
    review_policy: frontmatter.review_policy,
    summary: frontmatter.summary,
    doc_type: frontmatter.doc_type,
  };

  const templateSource = readFileSync(resolve(cwd, template.path), "utf8");
  const renderedBody = replaceTokens(templateSource, values).replace(/\s+$/u, "");

  const keyOrder = templatesResult.requiredFrontmatterKeys;
  const renderedFrontmatter = renderFrontmatter(frontmatter, keyOrder);
  return `${renderedFrontmatter}${renderedBody}\n`;
}
