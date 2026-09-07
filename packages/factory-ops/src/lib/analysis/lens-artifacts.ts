import { promises as fsPromises } from "node:fs";
import { join } from "node:path";

function asString(value) {
  return String(value ?? "").trim();
}

export function buildFallbackMarkdownFromFindings({
  date = "",
  repo = "",
  windowStart = "",
  windowEnd = "",
  normalizedAnalysis = {},
  collectorErrors = [],
} = {}) {
  const findings = Array.isArray(normalizedAnalysis.findings) ? normalizedAnalysis.findings : [];
  const suggestions = Array.isArray(normalizedAnalysis.suggestions) ? normalizedAnalysis.suggestions : [];

  const hasFindings = findings.length > 0 || suggestions.length > 0;
  if (!hasFindings) {
    return `# Daily Lens — ${date}\n\n\`${repo}\` · ${date} · \`${windowStart}\` → \`${windowEnd}\`\n\nAnalysis failed. See JSON artifacts for collector data.\n`;
  }

  const telemetryDark = Array.isArray(collectorErrors)
    && collectorErrors.some((err) => asString(err).includes("langfuse"));

  const lines = [
    `# Daily Lens — ${date}`,
    "",
    `\`${repo}\` · ${date} · \`${windowStart}\` → \`${windowEnd}\``,
    "",
  ];

  if (telemetryDark) {
    lines.push("> **Note:** Langfuse telemetry was unavailable for this window. Analysis is based on git and GitHub data only.");
    lines.push("");
  }

  if (findings.length > 0) {
    lines.push("## Findings");
    lines.push("");
    for (const finding of findings) {
      const id = asString(finding?.finding_id || finding?.id || "");
      const observation = asString(finding?.observation || finding?.summary || "");
      const inference = asString(finding?.inference || "");
      const action = asString(finding?.action || "");
      const priority = asString(finding?.priority || "");
      const confidence = asString(finding?.confidence || "");
      lines.push(`### ${id || observation || "Finding"}`);
      if (observation) lines.push(`**Observation:** ${observation}`);
      if (inference) lines.push(`**Inference:** ${inference}`);
      if (action) lines.push(`**Action:** ${action}`);
      if (priority || confidence) lines.push(`**Priority:** ${priority} · **Confidence:** ${confidence}`);
      lines.push("");
    }
  }

  if (suggestions.length > 0) {
    lines.push("## Suggestions");
    lines.push("");
    for (const suggestion of suggestions) {
      const id = asString(suggestion?.id || "");
      const summary = asString(suggestion?.summary || "");
      const whyNow = asString(suggestion?.why_now || suggestion?.whyNow || "");
      lines.push(`### ${id || summary || "Suggestion"}`);
      if (summary && id) lines.push(summary);
      if (whyNow) lines.push(`**Why now:** ${whyNow}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function resolveFs(fsOverride = {}) {
  return {
    mkdir: fsOverride.mkdir || fsPromises.mkdir.bind(fsPromises),
    writeFile: fsOverride.writeFile || fsPromises.writeFile.bind(fsPromises),
  };
}

export async function writeLensArtifacts({
  fs = {},
  outputDir = "reports/lens",
  date,
  lensJson,
  markdown = "",
  insightsLatest = [],
} = {}) {
  const normalizedDate = String(date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
    throw new Error(`lens_write_failed: invalid_date=${normalizedDate || "(empty)"}`);
  }

  const runtimeFs = resolveFs(fs);
  const jsonPath = join(outputDir, `${normalizedDate}.json`);
  const markdownPath = join(outputDir, `${normalizedDate}.md`);
  const insightsLatestPath = join(outputDir, "insights-latest.json");

  try {
    await runtimeFs.mkdir(outputDir, { recursive: true });
    await runtimeFs.writeFile(jsonPath, `${JSON.stringify(lensJson ?? {}, null, 2)}\n`, "utf8");
    await runtimeFs.writeFile(markdownPath, `${String(markdown ?? "").replace(/\n?$/, "\n")}`, "utf8");
    await runtimeFs.writeFile(insightsLatestPath, `${JSON.stringify(insightsLatest ?? [], null, 2)}\n`, "utf8");
  } catch (error) {
    throw new Error(`lens_write_failed: output_dir=${outputDir} date=${normalizedDate} message=${String(error?.message || error)}`);
  }

  return {
    output_dir: outputDir,
    date: normalizedDate,
    json_path: jsonPath,
    markdown_path: markdownPath,
    insights_latest_path: insightsLatestPath,
  };
}
