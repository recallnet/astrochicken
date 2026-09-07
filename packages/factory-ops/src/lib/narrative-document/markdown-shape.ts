function trim(value = "") {
  return String(value || "").trim();
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseFrontmatter(markdown = "") {
  const source = String(markdown || "");
  if (!source.startsWith("---\n")) {
    return { frontmatter: {}, body: source };
  }

  const closingIndex = source.indexOf("\n---\n", 4);
  if (closingIndex < 0) {
    throw new Error("narrative_markdown_frontmatter_unclosed");
  }

  const rawFrontmatter = source.slice(4, closingIndex).trim();
  if (!rawFrontmatter) {
    return { frontmatter: {}, body: source.slice(closingIndex + 5) };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawFrontmatter);
  } catch (error) {
    throw new Error(`narrative_markdown_frontmatter_invalid_json:${String(error?.message || error)}`);
  }

  if (!isObject(parsed)) {
    throw new Error("narrative_markdown_frontmatter_invalid:not_object");
  }

  return {
    frontmatter: parsed,
    body: source.slice(closingIndex + 5),
  };
}

function parseBody({ body = "", fallbackTitle = "" } = {}) {
  const lines = String(body || "").split(/\r?\n/u);

  let title = trim(fallbackTitle);
  let titleIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = trim(lines[index]);
    if (!line) continue;
    if (line.startsWith("# ")) {
      title = trim(line.slice(2));
      titleIndex = index;
    }
    break;
  }

  const contentLines = titleIndex >= 0 ? lines.slice(titleIndex + 1) : lines;
  const sections = [];
  const abstractLines = [];

  let currentSection = null;

  const flushSection = () => {
    if (!currentSection) return;
    sections.push({
      heading: trim(currentSection.heading),
      body: trim(currentSection.lines.join("\n")),
    });
    currentSection = null;
  };

  for (const line of contentLines) {
    const headingMatch = line.match(/^##\s+(.+)$/u);
    if (headingMatch) {
      flushSection();
      currentSection = { heading: headingMatch[1], lines: [] };
      continue;
    }

    if (currentSection) {
      currentSection.lines.push(line);
    } else {
      abstractLines.push(line);
    }
  }
  flushSection();

  return {
    title,
    abstract: trim(abstractLines.join("\n")),
    sections: sections.filter((section) => section.heading || section.body),
  };
}

export function parseNarrativeMarkdownDocument(markdown = "") {
  const { frontmatter, body } = parseFrontmatter(markdown);
  const parsedBody = parseBody({ body, fallbackTitle: frontmatter.title });

  const out = {
    title: parsedBody.title,
    abstract: parsedBody.abstract,
    sections: parsedBody.sections,
    metadata: isObject(frontmatter.metadata) ? frontmatter.metadata : {},
  };

  if (isObject(frontmatter.astrochicken)) {
    out.astrochicken = frontmatter.astrochicken;
  }

  return out;
}

function renderSection(section = {}) {
  const heading = trim(section?.heading);
  const body = trim(section?.body);
  return [`## ${heading}`, body].join("\n");
}

export function serializeNarrativeDocumentToMarkdown(document = {}) {
  const metadata = isObject(document?.metadata) ? document.metadata : {};
  const frontmatter = {
    metadata,
    ...(isObject(document?.astrochicken) ? { astrochicken: document.astrochicken } : {}),
  };

  const sections = Array.isArray(document?.sections) ? document.sections : [];

  const bodyParts = [
    `# ${trim(document?.title)}`,
    trim(document?.abstract),
    ...sections.map((section) => renderSection(section)),
  ].filter(Boolean);

  return [
    "---",
    JSON.stringify(frontmatter, null, 2),
    "---",
    "",
    ...bodyParts,
    "",
  ].join("\n");
}
