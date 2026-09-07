import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

/**
 * Extract pipeline= and template= references from a workflow source
 * data.json or a DOT file.
 */
export function extractPipelineRefs({ dataJson, dotContent, filePath = "" } = {}) {
  const refs = [];

  if (dataJson) {
    const nodes = dataJson.nodes || dataJson.nodeDefinitions || [];
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const attrs = node.dotAttributes || {};
      for (const kind of ["pipeline", "template"]) {
        const ref = String(attrs[kind] || "").trim();
        if (!ref) continue;
        // Skip factory-local references (resolved relative to workdir, not via require)
        if (!ref.startsWith("@")) continue;
        refs.push({
          ref,
          nodeId: String(node.id || ""),
          kind,
          filePath,
        });
      }
    }
  }

  if (dotContent) {
    const pipelinePattern = /(\w+)\s*\[.*?(?:pipeline|template)="(@[^"]+)"/g;
    let match;
    while ((match = pipelinePattern.exec(dotContent)) !== null) {
      refs.push({
        ref: match[2],
        nodeId: match[1],
        kind: dotContent.includes(`template="${match[2]}"`) ? "template" : "pipeline",
        filePath,
      });
    }
  }

  return refs;
}

/**
 * Verify that every pipeline/template reference resolves via require.resolve
 * from the hatch app context.
 */
export function verifyPipelineResolution({ refs = [], resolveFrom = "" } = {}) {
  const require = createRequire(join(resolve(resolveFrom), "dist", "cli.js"));
  const failures = [];

  for (const entry of refs) {
    try {
      require.resolve(entry.ref);
    } catch (err) {
      failures.push({
        ref: entry.ref,
        nodeId: entry.nodeId,
        kind: entry.kind,
        filePath: entry.filePath,
        error: String(err?.message || err).split("\n")[0],
      });
    }
  }

  return {
    ok: failures.length === 0,
    total: refs.length,
    failures,
  };
}

/**
 * Scan all workflow source data.json files and IR DOT files for
 * pipeline/template references and verify they resolve.
 */
export function scanAndVerify({ repoRoot = process.cwd(), resolveFrom = "" } = {}) {
  const allRefs = [];

  // Scan workflow source data.json files
  const packagesDir = join(repoRoot, "packages");
  for (const pkg of safeReaddir(packagesDir)) {
    const workflowsDir = join(packagesDir, pkg, "workflows");
    for (const wf of safeReaddir(workflowsDir)) {
      const dataJsonPath = join(workflowsDir, wf, `${wf}.workflow-source.data.json`);
      try {
        const data = JSON.parse(readFileSync(dataJsonPath, "utf8"));
        allRefs.push(...extractPipelineRefs({ dataJson: data, filePath: dataJsonPath }));
      } catch { /* file doesn't exist or isn't valid JSON */ }
    }
  }

  // Scan factory-local workflow source data.json files
  const factoriesDir = join(repoRoot, "factories");
  for (const factory of safeReaddir(factoriesDir)) {
    const workflowsDir = join(factoriesDir, factory, "workflows");
    for (const group of safeReaddir(workflowsDir)) {
      for (const file of safeReaddir(join(workflowsDir, group))) {
        if (!file.endsWith(".data.json")) continue;
        const dataJsonPath = join(workflowsDir, group, file);
        try {
          const data = JSON.parse(readFileSync(dataJsonPath, "utf8"));
          allRefs.push(...extractPipelineRefs({ dataJson: data, filePath: dataJsonPath }));
        } catch { /* skip */ }
      }
    }
  }

  // Scan IR DOT files
  const irDir = join(repoRoot, "docs", "contracts", "workflow-ir");
  for (const pkg of safeReaddir(irDir)) {
    const pkgDir = join(irDir, pkg);
    for (const file of safeReaddir(pkgDir)) {
      if (!file.endsWith(".dot")) continue;
      const dotPath = join(pkgDir, file);
      try {
        const content = readFileSync(dotPath, "utf8");
        allRefs.push(...extractPipelineRefs({ dotContent: content, filePath: dotPath }));
      } catch { /* skip */ }
    }
  }

  // Deduplicate by ref (same reference may appear in data.json and IR DOT)
  const seen = new Set();
  const uniqueRefs = allRefs.filter((r) => {
    const key = `${r.ref}:${r.nodeId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return verifyPipelineResolution({
    refs: uniqueRefs,
    resolveFrom: resolveFrom || join(repoRoot, "apps", "hatch"),
  });
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir).filter((entry) => {
      try { return statSync(join(dir, entry)).isDirectory() || entry.endsWith(".dot") || entry.endsWith(".data.json"); }
      catch { return false; }
    });
  } catch { return []; }
}
