import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const DEFAULT_INLINE_SCRIPT_BASELINE_FILE = "scripts/dot-inline-script-ignore-baseline.json";
export const INLINE_SCRIPT_BASELINE_SCHEMA = "dot_inline_script_ignore_baseline/v1";
export const INLINE_SCRIPT_BASELINE_DIFF_SCHEMA = "dot_inline_script_ignore_baseline_diff/v1";
export const INLINE_SCRIPT_MARKER_IDENTITY_VERSION = "v1";

function normalizePath(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

export function computeInlineScriptMarkerIdentity({ file, nodeId, handlerType, markerText }) {
  const seed = [
    INLINE_SCRIPT_MARKER_IDENTITY_VERSION,
    normalizePath(file),
    String(nodeId || "").trim(),
    String(handlerType || "").trim().toLowerCase(),
    String(markerText || "").trim(),
  ].join("|");
  return createHash("sha256").update(seed).digest("hex");
}

export function sortInlineScriptMarkers(entries) {
  return [...entries].sort((left, right) => {
    const fileCmp = left.file.localeCompare(right.file, "en");
    if (fileCmp !== 0) return fileCmp;

    const nodeCmp = left.node_id.localeCompare(right.node_id, "en");
    if (nodeCmp !== 0) return nodeCmp;

    const identityCmp = left.identity.localeCompare(right.identity, "en");
    if (identityCmp !== 0) return identityCmp;

    const handlerCmp = left.handler_type.localeCompare(right.handler_type, "en");
    if (handlerCmp !== 0) return handlerCmp;

    return left.node_label.localeCompare(right.node_label, "en");
  });
}

export function dedupeInlineScriptMarkers(entries) {
  const byIdentity = new Map();
  for (const entry of entries) {
    const identity = String(entry?.identity || "").trim();
    if (!identity) continue;
    if (byIdentity.has(identity)) continue;
    byIdentity.set(identity, entry);
  }
  return sortInlineScriptMarkers([...byIdentity.values()]);
}

export function toSerializableInlineScriptMarker(entry, { markerText }) {
  const file = normalizePath(entry?.file);
  const nodeId = String(entry?.node_id || entry?.nodeId || "").trim();
  const nodeLabel = String(entry?.node_label || entry?.nodeLabel || "").trim();
  const handlerType = String(entry?.handler_type || entry?.handlerType || "").trim().toLowerCase();

  if (!file || !nodeId || !handlerType) {
    throw new Error("invalid inline-script marker entry: expected file, node_id, handler_type");
  }

  const identity = String(entry?.identity || "").trim() || computeInlineScriptMarkerIdentity({
    file,
    nodeId,
    handlerType,
    markerText,
  });

  return {
    file,
    node_id: nodeId,
    node_label: nodeLabel,
    handler_type: handlerType,
    identity,
  };
}

export function loadInlineScriptBaseline({ baselineFile, markerText }) {
  const absolutePath = resolve(process.cwd(), baselineFile);
  if (!existsSync(absolutePath)) {
    throw new Error(`inline-script baseline file not found: ${baselineFile}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`invalid inline-script baseline JSON (${baselineFile}): ${String(error?.message || error)}`);
  }

  if (parsed?.schema !== INLINE_SCRIPT_BASELINE_SCHEMA) {
    throw new Error(`invalid inline-script baseline (${baselineFile}): expected schema=${INLINE_SCRIPT_BASELINE_SCHEMA}`);
  }

  if (!Array.isArray(parsed?.markers)) {
    throw new Error(`invalid inline-script baseline (${baselineFile}): markers must be an array`);
  }

  const markers = dedupeInlineScriptMarkers(
    parsed.markers.map((entry) => toSerializableInlineScriptMarker(entry, { markerText })),
  );

  return {
    schema: INLINE_SCRIPT_BASELINE_SCHEMA,
    markers,
  };
}

function buildInlineScriptBaselineArtifact({ markers, markerText }) {
  return {
    schema: INLINE_SCRIPT_BASELINE_SCHEMA,
    identity_format: `sha256(${INLINE_SCRIPT_MARKER_IDENTITY_VERSION}|<file>|<node_id>|<handler_type>|${markerText})`,
    markers: dedupeInlineScriptMarkers(
      markers.map((entry) => toSerializableInlineScriptMarker(entry, { markerText })),
    ),
  };
}

export function writeInlineScriptBaseline({ baselineFile, markers, markerText }) {
  const artifact = buildInlineScriptBaselineArtifact({ markers, markerText });
  const absolutePath = resolve(process.cwd(), baselineFile);
  writeFileSync(absolutePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}

export function listTrackedDotFiles() {
  const run = spawnSync("git", ["ls-files", "-z", "--", "*.dot"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (run.status !== 0) {
    const message = String(run.stderr || run.stdout || "git ls-files failed").trim();
    throw new Error(`failed to enumerate tracked dot files via git ls-files: ${message}`);
  }

  return String(run.stdout || "")
    .split("\0")
    .map((entry) => normalizePath(entry))
    .filter(Boolean)
    .filter((entry) => existsSync(resolve(process.cwd(), entry)))
    .sort((left, right) => left.localeCompare(right, "en"));
}

function markerDiffByIdentity({ baselineMarkers, currentMarkers }) {
  const baselineByIdentity = new Map();
  const currentByIdentity = new Map();

  for (const marker of baselineMarkers) {
    baselineByIdentity.set(marker.identity, marker);
  }

  for (const marker of currentMarkers) {
    currentByIdentity.set(marker.identity, marker);
  }

  const added = [];
  const removed = [];
  const unchanged = [];

  for (const [identity, marker] of currentByIdentity.entries()) {
    if (baselineByIdentity.has(identity)) {
      unchanged.push(marker);
      continue;
    }
    added.push(marker);
  }

  for (const [identity, marker] of baselineByIdentity.entries()) {
    if (currentByIdentity.has(identity)) continue;
    removed.push(marker);
  }

  return {
    added: sortInlineScriptMarkers(added),
    removed: sortInlineScriptMarkers(removed),
    unchanged: sortInlineScriptMarkers(unchanged),
  };
}

function groupMarkersByFile(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    if (!grouped.has(entry.file)) {
      grouped.set(entry.file, []);
    }
    grouped.get(entry.file).push(entry);
  }

  const result = [];
  for (const file of [...grouped.keys()].sort((left, right) => left.localeCompare(right, "en"))) {
    result.push({
      file,
      markers: sortInlineScriptMarkers(grouped.get(file) || []),
    });
  }
  return result;
}

export function inlineScriptBaselineDiffReport({ baselineFile, baselineMarkers, currentMarkers, governedFiles }) {
  const diff = markerDiffByIdentity({ baselineMarkers, currentMarkers });
  return {
    schema: INLINE_SCRIPT_BASELINE_DIFF_SCHEMA,
    baseline_file: normalizePath(baselineFile),
    governed_file_count: governedFiles.length,
    summary: {
      added: diff.added.length,
      removed: diff.removed.length,
      unchanged: diff.unchanged.length,
    },
    added: diff.added,
    removed: diff.removed,
    unchanged: diff.unchanged,
    per_file: {
      added: groupMarkersByFile(diff.added),
      removed: groupMarkersByFile(diff.removed),
    },
  };
}
