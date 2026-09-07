import { promises as fsPromises } from "node:fs";
import { dirname, join } from "node:path";

import { emitNarrativeDocument } from "./emit.ts";

function asString(value) {
  return String(value ?? "").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function renderList(items = [], fallback = "") {
  const lines = asArray(items)
    .map((entry) => asString(entry))
    .filter(Boolean)
    .map((entry) => `- ${entry}`);
  if (lines.length > 0) return lines.join("\n");
  return fallback;
}

function resolveOutputDir({ outputDir = "", artifacts = {} } = {}) {
  const explicit = asString(outputDir);
  if (explicit) return explicit;

  const fromArtifacts = asString(artifacts?.output_dir);
  if (fromArtifacts) return fromArtifacts;

  const artifactPath = asString(artifacts?.markdown_path || artifacts?.json_path);
  if (artifactPath) return dirname(artifactPath);

  return "reports/lens";
}

function buildFindingsSection(lensJson = {}) {
  const findings = asArray(lensJson?.findings).slice(0, 8);
  const lines = findings.map((finding = {}) => {
    const findingObject = asObject(finding);
    const observation = asString(
      findingObject?.observation
      || findingObject?.title
      || findingObject?.summary,
    );
    const action = asString(
      findingObject?.action
      || findingObject?.recommendation,
    );
    if (!observation && !action) return "";
    if (observation && action) return `${observation} — ${action}`;
    return observation || action;
  }).filter(Boolean);

  return renderList(lines, "- No findings were recorded for this window.");
}

function buildActionSection(lensJson = {}) {
  const source = asArray(lensJson?.action_registry).length > 0
    ? lensJson?.action_registry
    : lensJson?.suggestions;

  const lines = asArray(source).slice(0, 8).map((entry = {}) => {
    const item = asObject(entry);
    const title = asString(item?.title || item?.summary || item?.recommendation || item?.action);
    const whyNow = asString(item?.why_now || item?.whyNow || item?.impact_notes || item?.impactNotes);
    if (!title && !whyNow) return "";
    if (title && whyNow) return `${title} — ${whyNow}`;
    return title || whyNow;
  }).filter(Boolean);

  return renderList(lines, "- No follow-up actions met the quality bar for this window.");
}

function buildCollectorHealthSection(lensJson = {}) {
  const collectorHealth = asObject(lensJson?.collector_health);
  const status = asString(collectorHealth?.status || "unknown");
  const limitations = asArray(collectorHealth?.trust_limitations)
    .map((item) => asString(item))
    .filter(Boolean)
    .slice(0, 5);

  if (limitations.length < 1) {
    return `Status: ${status}`;
  }

  return [`Status: ${status}`, "", "Trust limitations:", renderList(limitations)].join("\n");
}

function buildNarrativeDocument({ reportDate = "", repo = "", factoryId = "", lensJson = {}, issueUrl = "" } = {}) {
  const executiveSummary = asObject(lensJson?.executive_summary);
  const title = asString(executiveSummary?.headline) || `Daily Lens Narrative — ${reportDate}`;
  const summary = asString(executiveSummary?.summary)
    || asString(lensJson?.meta_reflection?.data_quality_notes)
    || "Daily Lens summary was not provided.";

  const document = {
    title,
    abstract: summary,
    sections: [
      {
        heading: "Summary",
        body: summary,
      },
      {
        heading: "Key Findings",
        body: buildFindingsSection(lensJson),
      },
      {
        heading: "Recommended Follow-up",
        body: buildActionSection(lensJson),
      },
      {
        heading: "Collector Health",
        body: buildCollectorHealthSection(lensJson),
      },
    ],
    metadata: {
      taxonomy: ["factory-health", "operations"],
      source: "daily-lens",
    },
    astrochicken: {
      backlinks: {
        canonical_issue: issueUrl,
      },
      privacy: {
        publishable: false,
        contains_internal_only: true,
      },
    },
  };

  const metadata = {
    title,
    summary,
    category: "factory-health",
    published_on: reportDate,
    tags: ["daily-lens", "factory-ops"],
    topics: [repo, factoryId].map((entry) => asString(entry)).filter(Boolean),
    astro: {
      canonical_issue_url: issueUrl,
      visibility: "internal-only",
      internal_only_sections: ["Recommended Follow-up"],
    },
  };

  return { document, metadata };
}

export async function emitLensNarrativeDocument({
  reportDate = "",
  issueUrl = "",
  lensJson = {},
  repo = "",
  factoryId = "",
  outputDir = "",
  artifacts = {},
  fs = {},
} = {}) {
  const normalizedDate = asString(reportDate) || asString(lensJson?.date);
  const normalizedIssueUrl = asString(issueUrl);

  if (!normalizedDate) {
    throw new Error("lens_narrative_emit_failed:missing_report_date");
  }
  if (!normalizedIssueUrl) {
    throw new Error("lens_narrative_emit_failed:missing_issue_url");
  }

  const resolvedOutputDir = resolveOutputDir({ outputDir, artifacts });
  const narrativeJsonPath = join(resolvedOutputDir, `${normalizedDate}.narrative.json`);
  const narrativeMarkdownPath = join(resolvedOutputDir, `${normalizedDate}.narrative.md`);

  const { document, metadata } = buildNarrativeDocument({
    reportDate: normalizedDate,
    repo,
    factoryId,
    lensJson,
    issueUrl: normalizedIssueUrl,
  });

  const emitted = emitNarrativeDocument({
    document,
    metadata,
    astroContext: {
      canonical_issue: normalizedIssueUrl,
      publishable: false,
      contains_internal_only: true,
      internal_only_sections: ["Recommended Follow-up"],
    },
    outputPath: narrativeMarkdownPath,
  });

  const runtimeFs = {
    mkdir: fs?.mkdir || fsPromises.mkdir.bind(fsPromises),
    writeFile: fs?.writeFile || fsPromises.writeFile.bind(fsPromises),
  };

  await runtimeFs.mkdir(resolvedOutputDir, { recursive: true });
  await runtimeFs.writeFile(narrativeJsonPath, `${JSON.stringify(emitted.documentJson, null, 2)}\n`, "utf8");
  await runtimeFs.writeFile(narrativeMarkdownPath, `${String(emitted.markdown || "").replace(/\n?$/, "\n")}`, "utf8");

  return {
    json_path: narrativeJsonPath,
    markdown_path: narrativeMarkdownPath,
    metadata: emitted.metadata,
  };
}
