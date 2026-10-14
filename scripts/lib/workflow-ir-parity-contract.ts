import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { renderDotToPng } from "./workflow-diagram-png.ts";
import { isWorkflowSourceModulePath } from "./workflow-source-contract.ts";
import {
  deriveWorkflowDiagramPngPath,
  deriveWorkflowRuntimeDotPath,
  defineWorkflowIrModule,
  stringifyWorkflowIrDocument,
  stringifyWorkflowIrDocumentJsonSchema,
  renderWorkflowSourceModuleToDot,
} from "../../packages/factory-core/src/workflow-ir-registry.ts";
import { workflowIrBundleArtifactClass } from "../../packages/factory-ops/src/lib/oci-artifact-taxonomy.ts";

export const WORKFLOW_IR_REGISTRY_JSON_PATH = "docs/contracts/workflow-ir-registry.json";
export const WORKFLOW_IR_REGISTRY_MARKDOWN_PATH = "docs/contracts/workflow-ir-registry.md";
export const WORKFLOW_IR_SCHEMA_OUTPUT_PATH = "docs/contracts/workflow-ir-document.v1.schema.json";

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function trim(value = "") {
  return String(value ?? "").trim();
}

function listGitFiles(repoRoot, args) {
  const run = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (run.status !== 0) {
    throw new Error(`workflow_ir_git_ls_files_failed:${String(run.stderr || run.stdout || "").trim()}`);
  }
  return String(run.stdout || "")
    .split("\0")
    .map((entry) => trim(entry))
    .filter(Boolean);
}

function listCandidateFiles(repoRoot) {
  return [...new Set([
    ...listGitFiles(repoRoot, ["ls-files", "-z"]),
    ...listGitFiles(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ])].sort((left, right) => left.localeCompare(right));
}

function defaultReadFile(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function defaultReadBinary(filePath) {
  try {
    return readFileSync(filePath);
  } catch {
    return Buffer.alloc(0);
  }
}

function readPath(readFile, repoRoot, relativePath) {
  return readFile(path.join(repoRoot, relativePath)) || readFile(relativePath) || "";
}

function defaultImportWorkflowSource(repoRoot, relativePath) {
  return import(pathToFileURL(path.join(repoRoot, relativePath)).href);
}

function deriveOutputPath(factoryId = "", workflowId = "") {
  return `docs/contracts/${trim(factoryId)}.${trim(workflowId)}.workflow-ir.json`;
}

function deriveArtifactRef(factoryId = "", workflowId = "") {
  return `ghcr.io/recallnet/factory/workflow-ir:${trim(factoryId)}-${trim(workflowId)}`;
}

function deriveOwnerIdFromSourcePath(sourcePath = "") {
  const factoryMatch = trim(sourcePath).match(/^factories\/([^/]+)\//);
  if (factoryMatch) return factoryMatch[1];
  const packageMatch = trim(sourcePath).match(/^packages\/([^/]+)\//);
  if (packageMatch) return packageMatch[1];
  return "unknown_owner";
}

function buildMetadata(document) {
  const factoryId = deriveOwnerIdFromSourcePath(document.sourcePath);
  return {
    schema_version: "workflow_ir_artifact_metadata/v1",
    artifact_identity: {
      factory_id: factoryId,
      run_id: "workflow-ir-contract",
      capability_id: document.familyId,
      workflow_id: document.workflowId,
      workflow_source_revision: "typed-source-generated",
      correlation_id: `workflow-ir-contract:${document.workflowId}`,
    },
    workflow_graph_id: document.workflowId,
    compiler_version: "workflow_ir_compiler/v1",
  };
}

function renderMarkdown(entries, diagnostics) {
  return [
    "---",
    'doc_type: "reference"',
    'owner: "platform-architecture"',
    'review_policy: "periodic-7"',
    'reviewed: "2026-03-21"',
    'status: "active"',
    'summary: "Governed generated workflow IR registry for typed-source-authored runtime DOT families."',
    'tags: [contracts, dot, generated, parity, workflows]',
    'written: "2026-03-21"',
    "---",
    "",
    "# Workflow IR Registry",
    "",
    `- Registered generated workflow IR documents: ${entries.length}`,
    `- Diagnostics: ${diagnostics.length}`,
    "",
    "## Generated Runtime IR",
    "",
    ...entries.flatMap((entry) => [
      `- \`${entry.workflow_id}\``,
      `  - source: \`${entry.source_path}\``,
      `  - runtime graph: \`${entry.runtime_graph_path}\``,
      `  - runtime png: \`${entry.runtime_png_path}\``,
      `  - IR document: \`${entry.output_path}\``,
      `  - artifact ref: \`${entry.artifact_ref}\``,
    ]),
    "",
    "## Diagnostics",
    "",
    ...(diagnostics.length > 0 ? diagnostics.map((entry) => `- \`${entry}\``) : ["- none"]),
    "",
  ].join("\n");
}

function loadWorkflowSourceExport(moduleNamespace) {
  return moduleNamespace.WORKFLOW_SOURCE_MODULE
    || moduleNamespace.default
    || Object.values(moduleNamespace).find((value) =>
      value
      && typeof value === "object"
      && value.workflowId
      && value.runtimeGraphPath
      && value.sourcePath,
    )
    || null;
}

export async function analyzeWorkflowIrParityContract({
  repoRoot = process.cwd(),
  trackedFiles = listCandidateFiles(repoRoot),
  readFile = defaultReadFile,
  readBinary = defaultReadBinary,
  importWorkflowSource = defaultImportWorkflowSource,
  expectedRegistryJson = "",
  expectedRegistryMarkdown = "",
} = {}) {
  const diagnostics = [];
  const entries = [];
  const sourcePaths = trackedFiles.filter((filePath) => isWorkflowSourceModulePath(filePath));
  const irOutputPaths = [];

  for (const sourcePath of sourcePaths) {
    const moduleNamespace = await importWorkflowSource(repoRoot, sourcePath);
    const sourceDocument = loadWorkflowSourceExport(moduleNamespace);
    if (!sourceDocument) {
      diagnostics.push(`workflow_ir_missing_source_export source=${JSON.stringify(sourcePath)}`);
      continue;
    }
    if ((sourceDocument.sourceOwnership?.runtimeIr || "generated_dot_runtime_ir") !== "generated_dot_runtime_ir") {
      diagnostics.push(`workflow_ir_source_ownership_not_generated source=${JSON.stringify(sourcePath)}`);
      continue;
    }

    const renderedDot = renderWorkflowSourceModuleToDot(sourceDocument);
    const runtimeGraphPath = trim(sourceDocument.runtimeGraphPath)
      || deriveWorkflowRuntimeDotPath(sourcePath, sourceDocument.workflowId);
    const actualDot = readPath(readFile, repoRoot, runtimeGraphPath);
    if (actualDot !== renderedDot) {
      diagnostics.push(`workflow_ir_runtime_dot_drift graph=${JSON.stringify(runtimeGraphPath)}`);
    }
    const runtimePngPath = deriveWorkflowDiagramPngPath(runtimeGraphPath);
    const renderedPng = await renderDotToPng(renderedDot);
    const actualPng = readBinary(path.join(repoRoot, runtimePngPath));
    if (!Buffer.isBuffer(actualPng) || actualPng.length === 0) {
      diagnostics.push(`workflow_ir_runtime_png_drift graph=${JSON.stringify(runtimePngPath)} reason="missing"`);
    } else {
      const renderedPngSha = createHash("sha256").update(renderedPng).digest("hex");
      const actualPngSha = createHash("sha256").update(actualPng).digest("hex");
      if (renderedPngSha !== actualPngSha) {
        diagnostics.push(`workflow_ir_runtime_png_drift graph=${JSON.stringify(runtimePngPath)} reason="content_mismatch"`);
      }
    }

    const factoryId = deriveOwnerIdFromSourcePath(sourcePath);
    const outputPath = deriveOutputPath(factoryId, sourceDocument.workflowId);
    const irDocument = defineWorkflowIrModule({
      workflowId: sourceDocument.workflowId,
      familyId: sourceDocument.familyId,
      sourcePath,
      runtimeGraphPath,
      outputPath,
      compilerVersion: "workflow_ir_compiler/v1",
      artifactRef: deriveArtifactRef(factoryId, sourceDocument.workflowId),
      generatedFiles: [sourceDocument.runtimeGraphPath, runtimePngPath],
      metadata: buildMetadata(sourceDocument),
      artifactClassDefinition: workflowIrBundleArtifactClass,
      dot: renderedDot,
    });
    const renderedDocument = stringifyWorkflowIrDocument(irDocument);
    const actualDocument = readPath(readFile, repoRoot, outputPath);
    if (actualDocument !== renderedDocument) {
      diagnostics.push(`workflow_ir_document_drift output=${JSON.stringify(outputPath)}`);
    }

    irOutputPaths.push(outputPath);
    entries.push({
      workflow_id: sourceDocument.workflowId,
      family_id: sourceDocument.familyId,
      source_path: sourcePath,
      runtime_graph_path: runtimeGraphPath,
      runtime_png_path: runtimePngPath,
      output_path: outputPath,
      artifact_ref: irDocument.artifactRef,
    });
  }

  const sortedEntries = [...entries].sort((left, right) => left.workflow_id.localeCompare(right.workflow_id));
  const report = {
    schema_version: "workflow_ir_registry/v1",
    summary: {
      registered_workflow_irs: sortedEntries.length,
      diagnostics: diagnostics.length,
    },
    workflow_irs: sortedEntries,
    governed_outputs: irOutputPaths.sort((left, right) => left.localeCompare(right)),
    diagnostics,
  };

  const renderedJson = stableJson(report);
  const renderedMarkdown = `${renderMarkdown(sortedEntries, diagnostics)}\n`;
  const renderedSchema = stringifyWorkflowIrDocumentJsonSchema();

  if (expectedRegistryJson && expectedRegistryJson !== renderedJson) {
    diagnostics.push(`workflow_ir_registry_drift path=${JSON.stringify(WORKFLOW_IR_REGISTRY_JSON_PATH)}`);
  }
  if (expectedRegistryMarkdown && expectedRegistryMarkdown.trimEnd() !== renderedMarkdown.trimEnd()) {
    diagnostics.push(`workflow_ir_registry_drift path=${JSON.stringify(WORKFLOW_IR_REGISTRY_MARKDOWN_PATH)}`);
  }
  if (readPath(readFile, repoRoot, WORKFLOW_IR_SCHEMA_OUTPUT_PATH) !== renderedSchema) {
    diagnostics.push(`workflow_ir_schema_drift path=${JSON.stringify(WORKFLOW_IR_SCHEMA_OUTPUT_PATH)}`);
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    report: {
      ...report,
      diagnostics,
      summary: {
        ...report.summary,
        diagnostics: diagnostics.length,
      },
    },
    renderedJson: stableJson({
      ...report,
      diagnostics,
      summary: {
        ...report.summary,
        diagnostics: diagnostics.length,
      },
    }),
    renderedMarkdown,
    renderedSchema,
  };
}

export async function writeWorkflowIrParityOutputs({
  repoRoot = process.cwd(),
  trackedFiles = listCandidateFiles(repoRoot),
} = {}) {
  const analysis = await analyzeWorkflowIrParityContract({ repoRoot, trackedFiles });
  writeFileSync(path.join(repoRoot, WORKFLOW_IR_SCHEMA_OUTPUT_PATH), analysis.renderedSchema, "utf8");

  for (const entry of analysis.report.workflow_irs || []) {
    const sourceModule = await defaultImportWorkflowSource(repoRoot, entry.source_path);
    const sourceDocument = loadWorkflowSourceExport(sourceModule);
    if (!sourceDocument) continue;
    const runtimeGraphPath = trim(sourceDocument.runtimeGraphPath)
      || deriveWorkflowRuntimeDotPath(entry.source_path, sourceDocument.workflowId);
    const renderedDot = renderWorkflowSourceModuleToDot(sourceDocument);
    const renderedPng = await renderDotToPng(renderedDot);
    mkdirSync(path.dirname(path.join(repoRoot, runtimeGraphPath)), { recursive: true });
    writeFileSync(path.join(repoRoot, runtimeGraphPath), renderedDot, "utf8");
    writeFileSync(path.join(repoRoot, deriveWorkflowDiagramPngPath(runtimeGraphPath)), renderedPng);
    const irDocument = defineWorkflowIrModule({
      workflowId: sourceDocument.workflowId,
      familyId: sourceDocument.familyId,
      sourcePath: entry.source_path,
      runtimeGraphPath,
      outputPath: entry.output_path,
      compilerVersion: "workflow_ir_compiler/v1",
      artifactRef: deriveArtifactRef(deriveOwnerIdFromSourcePath(entry.source_path), sourceDocument.workflowId),
      generatedFiles: [
        runtimeGraphPath,
        deriveWorkflowDiagramPngPath(runtimeGraphPath),
      ],
      metadata: buildMetadata(sourceDocument),
      artifactClassDefinition: workflowIrBundleArtifactClass,
      dot: renderedDot,
    });
    mkdirSync(path.dirname(path.join(repoRoot, entry.output_path)), { recursive: true });
    writeFileSync(path.join(repoRoot, entry.output_path), stringifyWorkflowIrDocument(irDocument), "utf8");
  }

  const finalAnalysis = await analyzeWorkflowIrParityContract({ repoRoot, trackedFiles });
  writeFileSync(path.join(repoRoot, WORKFLOW_IR_REGISTRY_JSON_PATH), finalAnalysis.renderedJson, "utf8");
  writeFileSync(path.join(repoRoot, WORKFLOW_IR_REGISTRY_MARKDOWN_PATH), finalAnalysis.renderedMarkdown, "utf8");

  return analyzeWorkflowIrParityContract({
    repoRoot,
    trackedFiles,
    expectedRegistryJson: readFileSync(path.join(repoRoot, WORKFLOW_IR_REGISTRY_JSON_PATH), "utf8"),
    expectedRegistryMarkdown: readFileSync(path.join(repoRoot, WORKFLOW_IR_REGISTRY_MARKDOWN_PATH), "utf8").trimEnd(),
  });
}
