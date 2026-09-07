import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, normalize, resolve } from "node:path";

import { trim } from "../lib/cli-helpers.ts";


function resolveRepoRoot(repoRootValue = "") {
  const explicit = trim(repoRootValue);
  const fromEnv = trim(process.env.FACTORY_CONTEXT_REPO_PATH || process.env.HATCH_CANONICAL_CHECKOUT_PATH || "");
  const raw = explicit || fromEnv;
  return raw ? normalize(resolve(raw)) : "";
}

function resolvePath(pathValue = "", repoRoot = "") {
  const raw = trim(pathValue);
  if (!raw) return "";
  if (isAbsolute(raw)) return normalize(raw);
  if (!repoRoot) return "";
  return normalize(resolve(repoRoot, raw));
}

function writeAtomicUtf8(pathValue = "", content = "", repoRoot = "") {
  const targetPath = resolvePath(pathValue, repoRoot);
  if (!targetPath) {
    return { ok: false, code: "missing_path", path: "", bytes: 0 };
  }

  try {
    mkdirSync(dirname(targetPath), { recursive: true });
    const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
    const encoded = String(content ?? "");
    writeFileSync(tmpPath, encoded, "utf8");
    renameSync(tmpPath, targetPath);
    return { ok: true, code: "ok", path: targetPath, bytes: Buffer.byteLength(encoded, "utf8") };
  } catch (error) {
    return {
      ok: false,
      code: "write_failed",
      path: targetPath,
      bytes: 0,
      error: String(error?.message || error),
    };
  }
}

export function writeResearchArtifact({
  path = "",
  content = "",
  metricsPath = "",
  metricsContent = "",
  repoRoot = "",
} = {}) {
  const resolvedRepoRoot = resolveRepoRoot(repoRoot);
  const rawPath = trim(path);
  const rawMetricsPath = trim(metricsPath);
  const artifactPath = resolvePath(rawPath, resolvedRepoRoot);
  const artifactContent = String(content ?? "");
  const metricsPathResolved = resolvePath(rawMetricsPath, resolvedRepoRoot);
  const metricsContentRaw = String(metricsContent ?? "");

  if (!rawPath) {
    return {
      ok: false,
      error: "missing_path",
      artifact_path: "",
      artifact_bytes: 0,
    };
  }

  if (!trim(artifactContent)) {
    return {
      ok: false,
      error: "empty_content",
      artifact_path: artifactPath,
      artifact_bytes: 0,
    };
  }

  if (rawMetricsPath && !trim(metricsContentRaw)) {
    return {
      ok: false,
      error: "metrics_content_required",
      artifact_path: artifactPath,
      artifact_bytes: 0,
      metrics_path: metricsPathResolved,
      metrics_bytes: 0,
    };
  }

  if (!artifactPath) {
    return {
      ok: false,
      error: "relative_path_requires_repo_root",
      artifact_path: "",
      artifact_bytes: 0,
      repo_root: resolvedRepoRoot,
    };
  }

  if (rawMetricsPath && !metricsPathResolved) {
    return {
      ok: false,
      error: "relative_metrics_path_requires_repo_root",
      artifact_path: artifactPath,
      artifact_bytes: 0,
      metrics_path: "",
      metrics_bytes: 0,
      repo_root: resolvedRepoRoot,
    };
  }

  const artifactWrite = writeAtomicUtf8(artifactPath, artifactContent, resolvedRepoRoot);
  if (!artifactWrite.ok) {
    return {
      ok: false,
      error: artifactWrite.code || "artifact_write_failed",
      write_error: trim(artifactWrite.error || ""),
      artifact_path: artifactPath,
      artifact_bytes: 0,
    };
  }

  if (!metricsPathResolved) {
    return {
      ok: true,
      error: "",
      artifact_path: artifactWrite.path,
      artifact_bytes: artifactWrite.bytes,
      metrics_path: "",
      metrics_bytes: 0,
    };
  }

  const metricsWrite = writeAtomicUtf8(metricsPathResolved, metricsContentRaw, resolvedRepoRoot);
  if (!metricsWrite.ok) {
    return {
      ok: false,
      error: metricsWrite.code || "metrics_write_failed",
      write_error: trim(metricsWrite.error || ""),
      artifact_path: artifactWrite.path,
      artifact_bytes: artifactWrite.bytes,
      metrics_path: metricsPathResolved,
      metrics_bytes: 0,
    };
  }

  return {
    ok: true,
    error: "",
    artifact_path: artifactWrite.path,
    artifact_bytes: artifactWrite.bytes,
    metrics_path: metricsWrite.path,
    metrics_bytes: metricsWrite.bytes,
  };
}
