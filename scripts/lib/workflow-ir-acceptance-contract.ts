import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { analyzeWorkflowIrParityContract } from "./workflow-ir-parity-contract.ts";
import { analyzeWorkflowSourceContract } from "./workflow-source-contract.ts";
import { OCI_ARTIFACT_CLASSES } from "../../packages/factory-ops/src/lib/oci-artifact-taxonomy.ts";

const CLAIM_TRUTH_DOC_PATHS = Object.freeze([
  "docs/architecture/reactive-factory-dispatch.md",
  "docs/contracts/README.md",
  "packages/factory-core/src/workflow-ir-registry.ts",
  "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
]);

const OVERSTATED_PATTERNS = Object.freeze([
  /\bpublishes?\s+governed workflow IR bundles?\b/i,
  /\bcompiled IR packages through\b/i,
  /\bworkflow_ir_bundle\b[\s\S]{0,80}\bpublished\b/i,
]);

function readText(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function run(repoRoot, command, args) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function workflowIrArtifactClass() {
  return OCI_ARTIFACT_CLASSES.find((entry) => entry.key === "workflow_ir_bundle") || null;
}

export async function analyzeWorkflowIrAcceptanceContract({
  repoRoot = process.cwd(),
  includeRuntimeParity = true,
} = {}) {
  const diagnostics = [];
  const claimTruthDiagnostics = [];
  const publishStateDiagnostics = [];
  const runtimeParityDiagnostics = [];

  for (const relativePath of CLAIM_TRUTH_DOC_PATHS) {
    const source = readText(path.join(repoRoot, relativePath));
    for (const pattern of OVERSTATED_PATTERNS) {
      if (pattern.test(source)) {
        claimTruthDiagnostics.push(`workflow_ir_claim_overstated path=${JSON.stringify(relativePath)} pattern=${JSON.stringify(pattern.source)}`);
      }
    }
  }

  const workflowIrClass = workflowIrArtifactClass();
  if (!workflowIrClass) {
    publishStateDiagnostics.push("workflow_ir_publish_state_missing_class key=\"workflow_ir_bundle\"");
  } else {
    const publisherPaths = Array.isArray(workflowIrClass.governedPublisherPaths) ? workflowIrClass.governedPublisherPaths : [];
    const hasPublishers = publisherPaths.length > 0;
    const state = hasPublishers ? "published_and_verified" : "publication_ready_only";
    if (state !== "publication_ready_only") {
      for (const publisherPath of publisherPaths) {
        const source = readText(path.join(repoRoot, publisherPath));
        if (!/\bpublishOciArtifact\s*\(/.test(source)) {
          publishStateDiagnostics.push(`workflow_ir_publish_state_missing_publish_call path=${JSON.stringify(publisherPath)}`);
        }
      }
    }
    if (hasPublishers && /publication-intent metadata/i.test(String(workflowIrClass.description || ""))) {
      publishStateDiagnostics.push(`workflow_ir_publish_state_mixed_state key=${JSON.stringify(workflowIrClass.key)}`);
    }
  }

  if (includeRuntimeParity) {
    const workflowSourceAnalysis = await analyzeWorkflowSourceContract({ repoRoot });
    const workflowIrParityAnalysis = await analyzeWorkflowIrParityContract({ repoRoot });
    runtimeParityDiagnostics.push(...workflowSourceAnalysis.diagnostics);
    runtimeParityDiagnostics.push(...workflowIrParityAnalysis.diagnostics);

    const buildRun = run(repoRoot, "pnpm", ["--filter", "hatch", "--silent", "build"]);
    if (buildRun.status !== 0) {
      runtimeParityDiagnostics.push(`workflow_ir_runtime_validation_build_failed error=${JSON.stringify(String(buildRun.stderr || buildRun.stdout || "").trim())}`);
    } else {
      const workflowEntries = workflowIrParityAnalysis.report.workflow_irs || [];
      for (const entry of workflowEntries) {
        const validateRun = run(repoRoot, "node", ["apps/hatch/dist/cli.js", "validate", entry.runtime_graph_path]);
        if (validateRun.status !== 0) {
          runtimeParityDiagnostics.push(`workflow_ir_runtime_validation_failed graph=${JSON.stringify(entry.runtime_graph_path)}`);
        }
      }
    }
  }

  diagnostics.push(...claimTruthDiagnostics, ...publishStateDiagnostics, ...runtimeParityDiagnostics);

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    claimTruthDiagnostics,
    publishStateDiagnostics,
    runtimeParityDiagnostics,
  };
}
