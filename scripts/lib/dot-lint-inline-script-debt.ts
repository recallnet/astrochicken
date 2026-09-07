import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  dedupeInlineScriptMarkers,
  inlineScriptBaselineDiffReport,
  listTrackedDotFiles,
  loadInlineScriptBaseline,
  toSerializableInlineScriptMarker,
  writeInlineScriptBaseline,
} from "./inline-script-baseline.ts";

export function emitInlineScriptBaselineDiffTelemetry(report, { action, stderr = process.stderr } = {}) {
  stderr.write(
    `[dot-lint] inline_script_debt_${action}_summary target=${JSON.stringify(report.baseline_file)} added=${report.summary.added} removed=${report.summary.removed} unchanged=${report.summary.unchanged}\n`,
  );

  for (const marker of report.added) {
    stderr.write(
      `[dot-lint] inline_script_debt_added file=${JSON.stringify(marker.file)} node_id=${JSON.stringify(marker.node_id)} node_label=${JSON.stringify(marker.node_label)} handler_type=${marker.handler_type} identity=${JSON.stringify(marker.identity)}\n`,
    );
  }

  for (const marker of report.removed) {
    stderr.write(
      `[dot-lint] inline_script_debt_removed file=${JSON.stringify(marker.file)} node_id=${JSON.stringify(marker.node_id)} node_label=${JSON.stringify(marker.node_label)} handler_type=${marker.handler_type} identity=${JSON.stringify(marker.identity)}\n`,
    );
  }
}

export async function runInlineScriptBaselineMode({
  options,
  inlineScriptMarker,
  lintDotFiles,
}) {
  const governedFiles = listTrackedDotFiles();
  const lintResult = await lintDotFiles({
    files: governedFiles,
    compatFile: options.compatFile,
    enforceInlineScriptDebt: false,
  });

  const parseErrors = lintResult.diagnostics.filter((entry) => entry.rule_id === "parser.syntax" || entry.rule_id === "io.file_not_found");
  if (parseErrors.length > 0) {
    throw new Error(`cannot compute inline-script baseline markers: ${parseErrors[0].message}`);
  }

  const baselinePath = resolve(process.cwd(), options.inlineScriptBaselineFile);
  const priorBaselineMarkers = existsSync(baselinePath)
    ? loadInlineScriptBaseline({
      baselineFile: options.inlineScriptBaselineFile,
      markerText: inlineScriptMarker,
    }).markers
    : [];

  const report = inlineScriptBaselineDiffReport({
    baselineFile: options.inlineScriptBaselineFile,
    baselineMarkers: priorBaselineMarkers,
    currentMarkers: lintResult.inlineScriptMarkers,
    governedFiles,
  });

  if (options.inlineScriptBaselineRefresh) {
    writeInlineScriptBaseline({
      baselineFile: options.inlineScriptBaselineFile,
      markers: lintResult.inlineScriptMarkers,
      markerText: inlineScriptMarker,
    });
  }

  return report;
}

export function enforceInlineScriptDebt({
  files,
  inlineScriptMarkers,
  inlineScriptBaselineFile,
  inlineScriptMarker,
  normalizePath,
  toDiagnostic,
  debtRuleId,
}) {
  const markerLocationByIdentity = new Map();
  for (const marker of inlineScriptMarkers) {
    if (!marker?.identity) continue;
    if (markerLocationByIdentity.has(marker.identity)) continue;
    markerLocationByIdentity.set(marker.identity, marker);
  }

  try {
    const governedFiles = listTrackedDotFiles();
    const governedFileSet = new Set(governedFiles);
    const lintScopedFiles = [...new Set(files.map((entry) => normalizePath(entry)).filter((file) => governedFileSet.has(file)))];

    if (lintScopedFiles.length === 0) {
      return {
        diagnostics: [],
        report: null,
      };
    }

    const lintScopedFileSet = new Set(lintScopedFiles);
    const baseline = loadInlineScriptBaseline({
      baselineFile: inlineScriptBaselineFile,
      markerText: inlineScriptMarker,
    });
    const currentScopedMarkers = dedupeInlineScriptMarkers(
      inlineScriptMarkers
        .filter((entry) => lintScopedFileSet.has(entry.file))
        .map((entry) => toSerializableInlineScriptMarker(entry, { markerText: inlineScriptMarker })),
    );
    const baselineScopedMarkers = baseline.markers.filter((entry) => lintScopedFileSet.has(entry.file));

    const report = inlineScriptBaselineDiffReport({
      baselineFile: inlineScriptBaselineFile,
      baselineMarkers: baselineScopedMarkers,
      currentMarkers: currentScopedMarkers,
      governedFiles: lintScopedFiles,
    });

    const diagnostics = report.added.map((marker) => {
      const location = markerLocationByIdentity.get(marker.identity);
      return toDiagnostic({
        file: marker.file,
        severity: "error",
        ruleId: debtRuleId,
        message: `inline-script ignore debt increased: marker identity=${marker.identity} node=\"${marker.node_id}\" label=\"${marker.node_label}\" is not present in baseline ${normalizePath(inlineScriptBaselineFile)}; review with --inline-script-baseline-diff and apply --inline-script-baseline-refresh only when explicitly approved`,
        line: Number(location?.line || 1),
        column: Number(location?.column || 1),
        node: marker.node_id,
      });
    });

    return {
      diagnostics,
      report,
    };
  } catch (error) {
    return {
      diagnostics: [
        toDiagnostic({
          file: normalizePath(inlineScriptBaselineFile),
          severity: "error",
          ruleId: debtRuleId,
          message: `inline-script baseline check failed: ${String(error?.message || error)}`,
          line: 1,
          column: 1,
          node: "",
        }),
      ],
      report: null,
    };
  }
}
